import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

// ── Regex patterns ────────────────────────────────────────────────────────────
//
// REF_ANCHOR_RE  matches:  ref:a3f9c821   (NOT  to_ref:a3f9c821)
// TO_REF_RE      matches:  to_ref:a3f9c821
//
// UUID is exactly 8 lowercase hex characters.

const REF_ANCHOR_RE = /(?<![a-zA-Z_])ref:([a-f0-9]{8})(?![a-f0-9])/g;
const TO_REF_RE = /\bto_ref:([a-f0-9]{8})(?![a-f0-9])/g;

interface RefEntry {
  /** Relative path from workspace root */
  relPath: string;
  /** 1-indexed line number */
  line: number;
}

// ── RefsManager ───────────────────────────────────────────────────────────────

/**
 * Reads and watches the .refs file at the workspace root.
 * Fires onDidChange whenever the map is reloaded.
 */
class RefsManager implements vscode.Disposable {
  private map = new Map<string, RefEntry>();
  private watcher: vscode.FileSystemWatcher | undefined;

  readonly onDidChange = new vscode.EventEmitter<void>();

  activate(context: vscode.ExtensionContext): void {
    this.reload();

    // Watch any .refs file inside the workspace
    const watcher = vscode.workspace.createFileSystemWatcher("**/.refs");
    watcher.onDidChange(() => this.reload(), null, context.subscriptions);
    watcher.onDidCreate(() => this.reload(), null, context.subscriptions);
    watcher.onDidDelete(
      () => {
        this.map.clear();
        this.onDidChange.fire();
      },
      null,
      context.subscriptions
    );
    context.subscriptions.push(watcher);
    this.watcher = watcher;
  }

  reload(): void {
    this.map.clear();
    const refsFile = this.findRefsFile();
    if (!refsFile) {
      this.onDidChange.fire();
      return;
    }

    try {
      const text = fs.readFileSync(refsFile, "utf-8");
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        // Format:  <8-hex>  <relpath>:<lineno>
        const m = line.match(/^([a-f0-9]{8})\s+(.+):(\d+)$/);
        if (m) {
          this.map.set(m[1], { relPath: m[2], line: parseInt(m[3], 10) });
        }
      }
    } catch {
      // .refs unreadable — silently keep empty map
    }

    this.onDidChange.fire();
  }

  resolve(uuid: string): RefEntry | undefined {
    return this.map.get(uuid);
  }

  has(uuid: string): boolean {
    return this.map.has(uuid);
  }

  /** Resolve a UUID to an absolute vscode.Uri, or undefined if not found. */
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
      const p = path.join(folder.uri.fsPath, ".refs");
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

/**
 * Renders a subtle `→ path/to/file.py:42` annotation after each `to_ref:UUID`.
 */
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
    if (!this.enabled()) {
      editor.setDecorations(this.type, []);
      return;
    }

    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    TO_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TO_REF_RE.exec(text)) !== null) {
      const uuid = m[1];
      const entry = this.refs.resolve(uuid);
      const label = entry ? `→ ${entry.relPath}:${entry.line}` : `→ (unresolved)`;

      const start = editor.document.positionAt(m.index);
      const end = editor.document.positionAt(m.index + m[0].length);
      decorations.push({
        range: new vscode.Range(start, end),
        renderOptions: { after: { contentText: label } },
      });
    }

    editor.setDecorations(this.type, decorations);
  }

  updateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.update(editor);
    }
  }

  dispose(): void {
    this.type.dispose();
  }
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
      const uuid = m[1];
      const entry = this.refs.resolve(uuid);
      if (!entry) continue;

      const start = document.positionAt(m.index);
      const end = document.positionAt(m.index + m[0].length);
      const range = new vscode.Range(start, end);

      const uri = this.refs.resolveUri(uuid);
      if (!uri) continue;

      // VSCode interprets `L<n>` fragment as a line number (1-indexed)
      const target = uri.with({ fragment: `L${entry.line}` });
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = `coderef: go to ${entry.relPath}:${entry.line}`;
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
      /\bto_ref:[a-f0-9]{8}(?![a-f0-9])/
    );
    if (!wordRange) return undefined;

    const word = document.getText(wordRange);
    const uuid = word.slice("to_ref:".length);

    const entry = this.refs.resolve(uuid);
    if (!entry) {
      const md = new vscode.MarkdownString(
        `**coderef** ⚠️ Dangling reference\n\nUUID \`${uuid}\` has no entry in \`.refs\`.\n\n` +
          `Run the pre-commit hook (or \`coderef check\`) to audit all references.`
      );
      return new vscode.Hover(md, wordRange);
    }

    const uri = this.refs.resolveUri(uuid);
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`**coderef** \`${uuid}\`\n\n`);

    if (uri) {
      const target = uri.with({ fragment: `L${entry.line}` });
      md.appendMarkdown(
        `📍 [\`${entry.relPath}:${entry.line}\`](${target})\n\n` +
          `[Open file](${target})`
      );
    } else {
      md.appendMarkdown(`📍 \`${entry.relPath}:${entry.line}\``);
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
      /\bto_ref:[a-f0-9]{8}(?![a-f0-9])/
    );
    if (!wordRange) return undefined;

    const uuid = document.getText(wordRange).slice("to_ref:".length);
    const entry = this.refs.resolve(uuid);
    if (!entry) return undefined;

    const uri = this.refs.resolveUri(uuid);
    if (!uri) return undefined;

    // Position is 0-indexed in VSCode
    return new vscode.Location(uri, new vscode.Position(entry.line - 1, 0));
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
      case "error":
        return vscode.DiagnosticSeverity.Error;
      case "information":
        return vscode.DiagnosticSeverity.Information;
      case "hint":
        return vscode.DiagnosticSeverity.Hint;
      default:
        return vscode.DiagnosticSeverity.Warning;
    }
  }

  update(document: vscode.TextDocument): void {
    const diags: vscode.Diagnostic[] = [];
    const text = document.getText();
    const sev = this.severity();

    TO_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TO_REF_RE.exec(text)) !== null) {
      const uuid = m[1];
      if (!this.refs.has(uuid)) {
        const start = document.positionAt(m.index);
        const end = document.positionAt(m.index + m[0].length);
        const d = new vscode.Diagnostic(
          new vscode.Range(start, end),
          `coderef: dangling reference — '${uuid}' not found in .refs`,
          sev
        );
        d.source = "coderef";
        d.code = "dangling-ref";
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

  clear(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  dispose(): void {
    this.collection.dispose();
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
const SEMI_LANGS = new Set(["clojure", "lisp", "scheme", "racket"]);
const PERCENT_LANGS = new Set(["erlang", "latex", "matlab"]);

function commentPrefix(langId: string): string {
  if (HASH_LANGS.has(langId)) return "#";
  if (SLASH_LANGS.has(langId)) return "//";
  if (DASHDASH_LANGS.has(langId)) return "--";
  if (SEMI_LANGS.has(langId)) return ";";
  if (PERCENT_LANGS.has(langId)) return "%";
  return "//";
}

// ── Activate ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const refs = new RefsManager();
  refs.activate(context);

  const hints = new InlineHintProvider(refs);
  const diagnostics = new DiagnosticsProvider(refs);

  context.subscriptions.push(refs, hints, diagnostics);

  // ── Language providers ─────────────────────────────────────────────────────
  const selector: vscode.DocumentSelector = { scheme: "file" };
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      selector,
      new ToRefLinkProvider(refs)
    ),
    vscode.languages.registerHoverProvider(
      selector,
      new ToRefHoverProvider(refs)
    ),
    vscode.languages.registerDefinitionProvider(
      selector,
      new ToRefDefinitionProvider(refs)
    )
  );

  // ── Refresh on .refs change ────────────────────────────────────────────────
  refs.onDidChange.event(() => {
    hints.updateAll();
    diagnostics.updateAll();
  });

  // ── Refresh on editor events ───────────────────────────────────────────────
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        hints.update(editor);
        diagnostics.update(editor.document);
      }
    },
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeVisibleTextEditors(
    (editors) => {
      for (const editor of editors) {
        hints.update(editor);
        diagnostics.update(editor.document);
      }
    },
    null,
    context.subscriptions
  );

  // Debounced update on document edits
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
    null,
    context.subscriptions
  );

  // Clear diagnostics when a document is closed
  vscode.workspace.onDidCloseTextDocument(
    (doc) => diagnostics.clear(doc.uri),
    null,
    context.subscriptions
  );

  // ── Insert ref command ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("coderef.insertRef", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uuid = randomBytes(4).toString("hex");
      const prefix = commentPrefix(editor.document.languageId);
      const anchor = `${prefix} ref:${uuid}`;

      await editor.edit((eb) => {
        for (const sel of editor.selections) {
          const lineEnd = editor.document.lineAt(sel.active.line).range.end;
          eb.insert(lineEnd, `  ${anchor}`);
        }
      });

      await vscode.window.showInformationMessage(
        `coderef: inserted ref:${uuid}  (run git commit to update .refs)`
      );
    })
  );

  // Initial pass over already-open editors
  hints.updateAll();
  diagnostics.updateAll();
}

export function deactivate(): void {
  // VSCode disposes subscriptions automatically
}
