import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

// ── Regex patterns ────────────────────────────────────────────────────────────
//
// REF_MARKER_RE  matches all ref: forms (mirrors the hook's pattern)
// TO_REF_RE      matches to_ref:UUID

const REF_MARKER_RE =
  /(?<![a-zA-Z_])ref:([a-f0-9]{8})(?::(start|end|[a-z][a-z0-9-]*))?(?![a-f0-9:])/g;

// Matches to_ref: with optional commit/name prefix segments before the UUID.
// group(1) = full body, e.g. "a3f9c821", "HEAD:a3f9c821", "abc123:rate-limiter:a3f9c821"
const TO_REF_RE = /\bto_ref:((?:[-A-Za-z0-9._/@]+:)*[a-f0-9]{8})(?![a-f0-9:])/g;

// ── to_ref: body parser ───────────────────────────────────────────────────────

interface ParsedToRef {
  uuid: string;
  /** Commit SHA, branch, tag, or "HEAD" — present when the user pinned to a commit. */
  commit: string | undefined;
  /** Human-readable label embedded in the to_ref: body, e.g. "rate-limiter". */
  name: string | undefined;
}

function isCommitRef(s: string): boolean {
  if (s === "HEAD") return true;
  // All-hex, length 7–40, but NOT exactly 8 (which looks like a UUID)
  if (/^[0-9a-f]+$/.test(s) && s.length !== 8 && s.length >= 7 && s.length <= 40) return true;
  // Slash, dots, uppercase, or digit-first → branch/tag/version
  if (s.includes("/") || s.includes(".")) return true;
  if (/[A-Z]/.test(s) || /^\d/.test(s)) return true;
  return false;
}

function parseToRef(body: string): ParsedToRef {
  const parts = body.split(":");
  const uuid  = parts[parts.length - 1];
  let commit: string | undefined;
  let name:   string | undefined;

  if (parts.length === 2) {
    const seg = parts[0];
    if (isCommitRef(seg)) { commit = seg; }
    else                   { name   = seg; }
  } else if (parts.length >= 3) {
    commit = parts[0];
    name   = parts.slice(1, -1).join(":");
  }

  return { uuid, commit, name };
}

interface RefEntry {
  /** Relative path from workspace root */
  relPath: string;
  /** 1-indexed start line */
  line: number;
  /** 1-indexed end line — present for range refs */
  endLine?: number;
  /** Human-readable name, e.g. "auth-guard" */
  name?: string;
}

function entryLocation(entry: RefEntry): string {
  const lines = entry.endLine
    ? `${entry.line}-${entry.endLine}`
    : `${entry.line}`;
  const loc = `${entry.relPath}:${lines}`;
  return entry.name ? `${loc} (${entry.name})` : loc;
}

// ── RefsManager ───────────────────────────────────────────────────────────────

class RefsManager implements vscode.Disposable {
  private map = new Map<string, RefEntry>();
  private watcher: vscode.FileSystemWatcher | undefined;

  readonly onDidChange = new vscode.EventEmitter<void>();

  activate(context: vscode.ExtensionContext): void {
    this.reload();

    const watcher = vscode.workspace.createFileSystemWatcher("**/.coderef");
    watcher.onDidChange(() => this.reload(), null, context.subscriptions);
    watcher.onDidCreate(() => this.reload(), null, context.subscriptions);
    watcher.onDidDelete(
      () => { this.map.clear(); this.onDidChange.fire(); },
      null,
      context.subscriptions
    );
    context.subscriptions.push(watcher);
    this.watcher = watcher;
  }

  reload(): void {
    this.map.clear();
    const refsFile = this.findRefsFile();
    if (!refsFile) { this.onDidChange.fire(); return; }

    try {
      const text = fs.readFileSync(refsFile, "utf-8");
      for (const raw of text.split("\n")) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Format: <8-hex>  <relpath>:<line>[-<endline>] [<name>]
        const m = trimmed.match(
          /^([a-f0-9]{8})\s+(.+):(\d+)(?:-(\d+))?(?:\s+([a-z][a-z0-9-]*))?$/
        );
        if (m) {
          this.map.set(m[1], {
            relPath: m[2],
            line: parseInt(m[3], 10),
            endLine: m[4] ? parseInt(m[4], 10) : undefined,
            name: m[5] ?? undefined,
          });
        }
      }
    } catch {
      // .coderef unreadable — keep empty map
    }

    this.onDidChange.fire();
  }

  resolve(uuid: string): RefEntry | undefined { return this.map.get(uuid); }
  has(uuid: string): boolean { return this.map.has(uuid); }
  all(): ReadonlyMap<string, RefEntry> { return this.map; }

  resolveUri(uuid: string): vscode.Uri | undefined {
    const entry = this.resolve(uuid);
    if (!entry) return undefined;
    const root = this.workspaceRoot();
    if (!root) return undefined;
    return vscode.Uri.file(path.join(root, entry.relPath));
  }

  workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  findRefsFile(): string | undefined {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const p = path.join(folder.uri.fsPath, ".coderef");
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }

  dispose(): void {
    this.watcher?.dispose();
    this.onDidChange.dispose();
  }
}

// ── Inline decoration provider ────────────────────────────────────────────────

class InlineHintProvider implements vscode.Disposable {
  private readonly type: vscode.TextEditorDecorationType;

  constructor(private readonly refs: RefsManager) {
    this.type = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        margin: "0 0 0 0.6em",
        fontStyle: "italic",
      },
    });
  }

  private enabled(): boolean {
    return vscode.workspace
      .getConfiguration("coderef")
      .get<boolean>("showInlineHints", true);
  }

  update(editor: vscode.TextEditor): void {
    if (!this.enabled()) { editor.setDecorations(this.type, []); return; }

    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    TO_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TO_REF_RE.exec(text)) !== null) {
      const { uuid, commit } = parseToRef(m[1]);
      const entry     = this.refs.resolve(uuid);
      const isPinned  = commit !== undefined && commit !== "HEAD";

      let label: string;
      if (entry) {
        const loc = entryLocation(entry);
        label = isPinned ? `→ [${commit}] ${loc}` : `→ ${loc}`;
      } else if (isPinned) {
        label = `→ [${commit}] (historical)`;
      } else {
        label = `→ (unresolved)`;
      }

      const start = editor.document.positionAt(m.index);
      const end   = editor.document.positionAt(m.index + m[0].length);
      decorations.push({
        range: new vscode.Range(start, end),
        renderOptions: { after: { contentText: label } },
      });
    }

    editor.setDecorations(this.type, decorations);
  }

  updateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.update(editor);
  }

  dispose(): void { this.type.dispose(); }
}

// ── DocumentLink provider (ctrl+click navigation) ────────────────────────────

class ToRefLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly refs: RefsManager) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];
    const text = document.getText();

    TO_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TO_REF_RE.exec(text)) !== null) {
      const { uuid } = parseToRef(m[1]);
      const entry = this.refs.resolve(uuid);
      const uri   = this.refs.resolveUri(uuid);
      if (!entry || !uri) continue;

      const start = document.positionAt(m.index);
      const end   = document.positionAt(m.index + m[0].length);
      const target = uri.with({ fragment: `L${entry.line}` });
      const link   = new vscode.DocumentLink(new vscode.Range(start, end), target);
      link.tooltip = `coderef: go to ${entryLocation(entry)}`;
      links.push(link);
    }

    return links;
  }
}

// ── Hover provider ────────────────────────────────────────────────────────────

class ToRefHoverProvider implements vscode.HoverProvider {
  constructor(private readonly refs: RefsManager) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const wordRange = document.getWordRangeAtPosition(
      position,
      /\bto_ref:(?:[-A-Za-z0-9._/@]+:)*[a-f0-9]{8}(?![a-f0-9:])/
    );
    if (!wordRange) return undefined;

    const body = document.getText(wordRange).slice("to_ref:".length);
    const { uuid, commit, name: toRefLabel } = parseToRef(body);
    const entry    = this.refs.resolve(uuid);
    const isPinned = commit !== undefined && commit !== "HEAD";

    // Historical reference — pinned to a specific commit, not in current .coderef
    if (!entry && isPinned) {
      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.appendMarkdown(`**coderef** \`${uuid}\``);
      if (toRefLabel) md.appendMarkdown(` — *${toRefLabel}*`);
      md.appendMarkdown(`\n\n🔒 Pinned to commit \`${commit}\`\n\n`);
      md.appendMarkdown(
        `Historical reference — UUID not in current \`.coderef\`. ` +
        `This \`to_ref:\` points to code as it existed at \`${commit}\`.`
      );
      return new vscode.Hover(md, wordRange);
    }

    // Dangling reference — no commit pin and not in .coderef
    if (!entry) {
      return new vscode.Hover(
        new vscode.MarkdownString(
          `**coderef** ⚠️ Dangling reference\n\nUUID \`${uuid}\` has no entry in \`.coderef\`.\n\n` +
          `Run the pre-commit hook or \`coderef check\` to audit all references.`
        ),
        wordRange
      );
    }

    const uri = this.refs.resolveUri(uuid);
    const md  = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**coderef** \`${uuid}\``);
    if (entry.name) md.appendMarkdown(` — *${entry.name}*`);
    if (toRefLabel && toRefLabel !== entry.name) {
      md.appendMarkdown(` *(label: ${toRefLabel})*`);
    }
    md.appendMarkdown(`\n\n`);
    if (isPinned) md.appendMarkdown(`🔒 Pinned to \`${commit}\`\n\n`);

    if (uri) {
      const target  = uri.with({ fragment: `L${entry.line}` });
      const locStr  = entryLocation(entry);
      const badge   = entry.endLine ? " *(range)*" : "";
      md.appendMarkdown(`📍 [\`${locStr}\`](${target})${badge}\n\n[Open file](${target})`);
    } else {
      md.appendMarkdown(`📍 \`${entryLocation(entry)}\``);
    }

    return new vscode.Hover(md, wordRange);
  }
}

// ── Definition provider (F12 / go-to-definition) ─────────────────────────────

class ToRefDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly refs: RefsManager) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location | undefined {
    const wordRange = document.getWordRangeAtPosition(
      position,
      /\bto_ref:(?:[-A-Za-z0-9._/@]+:)*[a-f0-9]{8}(?![a-f0-9:])/
    );
    if (!wordRange) return undefined;

    const body  = document.getText(wordRange).slice("to_ref:".length);
    const { uuid } = parseToRef(body);
    const entry = this.refs.resolve(uuid);
    if (!entry) return undefined;
    const uri = this.refs.resolveUri(uuid);
    if (!uri) return undefined;

    const startPos = new vscode.Position(entry.line - 1, 0);
    const endPos   = entry.endLine
      ? new vscode.Position(entry.endLine - 1, Number.MAX_SAFE_INTEGER)
      : startPos;
    return new vscode.Location(uri, new vscode.Range(startPos, endPos));
  }
}

// ── Diagnostics (dangling refs) ───────────────────────────────────────────────

class DiagnosticsProvider implements vscode.Disposable {
  private readonly collection =
    vscode.languages.createDiagnosticCollection("coderef");

  constructor(private readonly refs: RefsManager) {}

  private severity(): vscode.DiagnosticSeverity {
    const cfg = vscode.workspace
      .getConfiguration("coderef")
      .get<string>("diagnosticSeverity", "warning");
    switch (cfg) {
      case "error":       return vscode.DiagnosticSeverity.Error;
      case "information": return vscode.DiagnosticSeverity.Information;
      case "hint":        return vscode.DiagnosticSeverity.Hint;
      default:            return vscode.DiagnosticSeverity.Warning;
    }
  }

  update(document: vscode.TextDocument): void {
    const diags: vscode.Diagnostic[] = [];
    const text = document.getText();
    const sev  = this.severity();

    TO_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TO_REF_RE.exec(text)) !== null) {
      const { uuid, commit } = parseToRef(m[1]);
      const isPinned = commit !== undefined && commit !== "HEAD";
      // Commit-pinned historical refs are intentional — don't flag them
      if (!isPinned && !this.refs.has(uuid)) {
        const start = document.positionAt(m.index);
        const end   = document.positionAt(m.index + m[0].length);
        const d = new vscode.Diagnostic(
          new vscode.Range(start, end),
          `coderef: dangling reference — '${uuid}' not found in .coderef`,
          sev
        );
        d.source = "coderef";
        d.code   = "dangling-ref";
        diags.push(d);
      }
    }

    this.collection.set(document.uri, diags);
  }

  updateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.update(editor.document);
    }
  }

  clear(uri: vscode.Uri): void { this.collection.delete(uri); }
  dispose(): void { this.collection.dispose(); }
}

// ── Completion provider (to_ref: autocomplete) ───────────────────────────────

class ToRefCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly refs: RefsManager) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    // Trigger when cursor follows `to_ref:` or `to_ref:<commit>:` or `to_ref:<commit>:<name>:`
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    if (!linePrefix.match(/\bto_ref:(?:[-A-Za-z0-9._/@]+:)*$/)) return [];

    const items: vscode.CompletionItem[] = [];

    for (const [uuid, entry] of this.refs.all()) {
      const label = uuid;
      const item  = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);

      item.insertText  = uuid;
      item.detail      = entryLocation(entry);
      item.filterText  = `${uuid} ${entry.name ?? ""} ${entry.relPath}`;

      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${uuid}**`);
      if (entry.name) md.appendMarkdown(` — *${entry.name}*`);
      md.appendMarkdown(`\n\n📍 \`${entryLocation(entry)}\``);
      item.documentation = md;

      // Sort: named refs first, then by UUID
      item.sortText = entry.name ? `0_${uuid}` : `1_${uuid}`;

      items.push(item);
    }

    return items;
  }
}

// ── Comment-prefix helper ─────────────────────────────────────────────────────

const HASH_LANGS = new Set([
  "python", "ruby", "shellscript", "bash", "sh", "zsh", "fish",
  "yaml", "toml", "perl", "r", "coffeescript", "elixir", "crystal",
  "julia", "nim", "makefile", "dockerfile", "powershell",
]);
const SLASH_LANGS = new Set([
  "javascript", "typescript", "javascriptreact", "typescriptreact",
  "java", "c", "cpp", "csharp", "go", "rust", "swift", "kotlin",
  "scala", "dart", "php", "css", "scss", "less", "groovy", "json5",
]);
const DASHDASH_LANGS = new Set(["sql", "lua", "haskell", "elm"]);
const SEMI_LANGS     = new Set(["clojure", "lisp", "scheme", "racket"]);
const PERCENT_LANGS  = new Set(["erlang", "latex", "matlab"]);

function commentPrefix(langId: string): string {
  if (HASH_LANGS.has(langId))     return "#";
  if (SLASH_LANGS.has(langId))    return "//";
  if (DASHDASH_LANGS.has(langId)) return "--";
  if (SEMI_LANGS.has(langId))     return ";";
  if (PERCENT_LANGS.has(langId))  return "%";
  return "//";
}

// ── Activate ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const refs        = new RefsManager();
  const hints       = new InlineHintProvider(refs);
  const diagnostics = new DiagnosticsProvider(refs);

  refs.activate(context);
  context.subscriptions.push(refs, hints, diagnostics);

  // ── Language providers ─────────────────────────────────────────────────────
  const selector: vscode.DocumentSelector = { scheme: "file" };
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(selector, new ToRefLinkProvider(refs)),
    vscode.languages.registerHoverProvider(selector, new ToRefHoverProvider(refs)),
    vscode.languages.registerDefinitionProvider(selector, new ToRefDefinitionProvider(refs)),
    vscode.languages.registerCompletionItemProvider(
      selector,
      new ToRefCompletionProvider(refs),
      ":"  // trigger character — fires when user types `to_ref:`
    )
  );

  // ── Refresh on .coderef change ────────────────────────────────────────────────
  refs.onDidChange.event(() => {
    hints.updateAll();
    diagnostics.updateAll();
  });

  // ── Refresh on editor events ───────────────────────────────────────────────
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => { if (editor) { hints.update(editor); diagnostics.update(editor.document); } },
    null, context.subscriptions
  );
  vscode.window.onDidChangeVisibleTextEditors(
    (editors) => { for (const e of editors) { hints.update(e); diagnostics.update(e.document); } },
    null, context.subscriptions
  );

  let debounce: ReturnType<typeof setTimeout> | undefined;
  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === event.document.uri.toString()
        );
        if (editor) hints.update(editor);
        diagnostics.update(event.document);
      }, 250);
    },
    null, context.subscriptions
  );
  vscode.workspace.onDidCloseTextDocument(
    (doc) => diagnostics.clear(doc.uri),
    null, context.subscriptions
  );

  // ── Insert point ref command ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("coderef.insertRef", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uuid   = randomBytes(4).toString("hex");
      const prefix = commentPrefix(editor.document.languageId);

      // Optionally prompt for a name
      const name = await vscode.window.showInputBox({
        prompt: "Optional name for this anchor (e.g. auth-guard) — leave blank to skip",
        placeHolder: "my-anchor-name",
        validateInput: (v) =>
          !v || /^[a-z][a-z0-9-]*$/.test(v)
            ? undefined
            : "Name must be lowercase letters, digits, and hyphens only",
      });
      if (name === undefined) return; // user cancelled

      const anchor = name
        ? `${prefix} ref:${uuid}:${name}`
        : `${prefix} ref:${uuid}`;

      await editor.edit((eb) => {
        for (const sel of editor.selections) {
          const lineEnd = editor.document.lineAt(sel.active.line).range.end;
          eb.insert(lineEnd, `  ${anchor}`);
        }
      });

      await vscode.window.showInformationMessage(
        `coderef: inserted ${name ? `ref:${uuid}:${name}` : `ref:${uuid}`}  (run git commit to update .coderef)`
      );
    })
  );

  // ── Insert range ref command ───────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("coderef.insertRangeRef", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uuid   = randomBytes(4).toString("hex");
      const prefix = commentPrefix(editor.document.languageId);
      const sel    = editor.selection;
      const multiLine = sel.end.line > sel.start.line;

      await editor.edit((eb) => {
        if (multiLine) {
          const startLineEnd = editor.document.lineAt(sel.start.line).range.end;
          const endLineEnd   = editor.document.lineAt(sel.end.line).range.end;
          eb.insert(endLineEnd,   `  ${prefix} ref:${uuid}:end`);
          eb.insert(startLineEnd, `  ${prefix} ref:${uuid}:start`);
        } else {
          const lineEnd = editor.document.lineAt(sel.active.line).range.end;
          eb.insert(lineEnd, `  ${prefix} ref:${uuid}:start`);
        }
      });

      const msg = multiLine
        ? `coderef: inserted range ref:${uuid}  (run git commit to update .coderef)`
        : `coderef: inserted ref:${uuid}:start — add ref:${uuid}:end at the block's closing line`;
      await vscode.window.showInformationMessage(msg);
    })
  );

  hints.updateAll();
  diagnostics.updateAll();
}

export function deactivate(): void {}
