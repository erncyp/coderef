# coderef

Stable UUID-based code refs that survive renames, moves, and refactors.

Place a `ref:` anywhere in source. Reference it from anywhere else with `to_ref:`. A git hook keeps `.coderef` — a small text file — up to date with every ref's current location.

```python
# src/auth/middleware.py

def check_token(request):
    # ref:a3f9c821  ← ref lives here
    ...
```

```python
# src/api/routes.py

# Token validation logic: see to_ref:a3f9c821  ← click to jump there
```

```
# .coderef
a3f9c821 src/auth/middleware.py:14
```

UUIDs are 8-character lowercase hex strings and are language-agnostic — any file type that supports comments works.

---

## Contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Refs](#refs) — point, named, multi-line
- [to\_ref: syntax](#to_ref-syntax) — plain, labelled, commit-pinned
- [CLI](#cli)
- [Git hook](#git-hook)
- [pre-commit framework](#pre-commit-framework)
- [VSCode extension](#vscode-extension)
- [Vim / Neovim plugin](#vim--neovim-plugin)
- [MCP server](#mcp-server)
- [.coderef format](#coderef-format)
- [FAQ](#faq)

---

## How it works

| Piece | Role |
|---|---|
| `ref:<uuid>` | Marks a location as a stable ref |
| `to_ref:<uuid>` | References that ref from anywhere |
| `.coderef` | Maps each UUID to its current `file:line` |
| `hooks/pre-commit` | Rewrites `.coderef` on every commit |
| `cli/coderef` | CLI for resolving refs and checking for broken ones |
| `vscode-extension/` | Inline hints, hover, go-to-definition, diagnostics |
| `vim-plugin/` | Same for Vim 8+ and Neovim |
| `mcp-server/` | MCP tools so AI assistants can navigate refs directly |

---

## Installation

### 1. Install the package

```bash
pip install coderef
```

**Requirements:** Python 3.9+.

### 2. Install the git hook into your project

From inside your project's directory:

```bash
cd /your/project
coderef install
```

This copies the pre-commit, post-checkout, and post-merge hooks into `.git/hooks/` and creates an empty `.coderef` if one doesn't exist. Any existing hooks are chained rather than replaced.

### 3. Commit `.coderef` to your repository

```bash
git add .coderef
git commit -m "add coderef"
```

From now on, every `git commit` automatically updates `.coderef`.

---

## Refs

### Point ref

Add `ref:<uuid>` anywhere in a comment:

```python
# ref:a3f9c821
def verify_signature(token: str) -> bool:
    ...
```

```typescript
// ref:b7d2e104
export function rateLimiter(req, res, next) {
```

```sql
-- ref:c9f01a3d
CREATE INDEX idx_users_email ON users(email);
```

### Named ref

Append a lowercase label after the UUID. The label appears in hover cards, inline hints, and autocomplete:

```python
# ref:a3f9c821:auth-guard
def verify_signature(token: str) -> bool:
    ...
```

### Multi-line ref

Wrap any block with `:start` and `:end`. The UUID must match on both lines — this is how the parser knows which pair goes together, and makes mismatches obvious at a glance:

```python
# ref:b7d2e104:start
def rate_limiter(req, res, next):
    key = f"rl:{req.remote_addr}"
    count = cache.incr(key)
    if count > RATE_LIMIT:
        return abort(429)
    return next()
# ref:b7d2e104:end
```

In `.coderef` the entry stores the full line range:

```
b7d2e104 src/api/server.py:42-49
```

Navigating `to_ref:b7d2e104` takes you to line 42 and highlights the whole block.

Ranges can be nested — each UUID is independent:

```python
# ref:aaaa1234:start
class AuthService:
    # ref:bbbb5678:start
    def check_token(self, token):
        ...
    # ref:bbbb5678:end
# ref:aaaa1234:end
```

---

## to_ref: syntax

| Form | Meaning |
|---|---|
| `to_ref:a3f9c821` | Reference at HEAD |
| `to_ref:rate-limiter:a3f9c821` | Labelled reference at HEAD |
| `to_ref:@abc1234:a3f9c821` | Pinned to a specific commit |
| `to_ref:@abc1234:rate-limiter:a3f9c821` | Pinned + labelled |

The `@` sigil unambiguously marks a commit ref. Commit-pinned references appear as `→ [abc1234] (historical)` in editor hints and do not cause `coderef check` to fail — they are intentional citations to a point in history.

---

## CLI

```bash
coderef <command>
```

| Command | Description |
|---|---|
| `coderef resolve <uuid>` | Print the current `file:line` for a UUID |
| `coderef resolve <uuid> --context N` | Show N lines of source around the ref |
| `coderef list` | List all UUIDs and their locations |
| `coderef check` | Report dangling `to_ref:` and invalid ranges; exits 1 if found |
| `coderef check --strict` | Also exit 1 on orphan refs (never referenced) |
| `coderef scan` | Rebuild `.coderef` on demand without a git commit |
| `coderef scan --dry-run` | Show what would change without writing |
| `coderef graph` | Emit the full ref→reference graph as JSON |
| `coderef install` | Install the git hooks into the current repo |

### Examples

```bash
$ coderef resolve a3f9c821
src/auth/middleware.py:14

$ coderef resolve a3f9c821 --context 3
src/auth/middleware.py:14

   12:
   13: def check_token(request):
 > 14:     # ref:a3f9c821
   15:     ...

$ coderef list
a3f9c821  src/auth/middleware.py:14  [point]
b7d2e104  src/api/server.py:42-49   [range]

$ coderef check
ok: no issues (2 points)

$ coderef check   # with a dangling ref
DANGLING to_ref: (UUID has no ref in .coderef)
  src/api/routes.py:31: to_ref:deadbeef
# exits with code 1
```

---

## Git hook

The pre-commit hook runs automatically on every `git commit`. It:

1. Scans all tracked and staged files for `ref:` markers
2. Validates that every `:start` has a matching `:end` with the same UUID — exits 1 on mismatch
3. Rewrites `.coderef` with the current `file:line` for every ref
4. Stages the updated `.coderef`

The post-checkout and post-merge hooks keep `.coderef` current after branch switches and pulls without requiring a new commit.

**Cleanup is automatic** — `.coderef` is rebuilt from scratch on every commit, so deleted refs are removed and moved refs get their new location.

---

## pre-commit framework

If you use the [pre-commit](https://pre-commit.com/) framework, add this to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/erncyp/coderef
    rev: v0.1.0          # replace with the desired tag or SHA
    hooks:
      - id: coderef-scan   # omit if you already have the git hook installed
      - id: coderef-check
```

`coderef-check` fails if any `to_ref:` is dangling or any range pair is mismatched. `coderef-scan` rebuilds `.coderef` first — skip it if you have the git hook installed.

The CLI is also available via pip if you don't want to use pre-commit:

```bash
pip install coderef
```

---

## VSCode extension

### Install

```bash
cd vscode-extension
npm install
npm run compile
npx vsce package          # produces coderef-0.1.0.vsix
code --install-extension coderef-0.1.0.vsix
```

**Requirements:** Node.js 18+, npm.

### Features

**Inline hints** — every `to_ref:` gets an annotation:
```
# see to_ref:a3f9c821  → src/auth/middleware.py:14
# see to_ref:@abc1234:rate-limiter:b7d2e104  → [abc1234] src/api/server.py:42-49
```

**Hover** — hover over any `to_ref:` for a card with the file path, line, and a clickable link. Commit-pinned refs show their commit badge. Dangling refs show a warning.

**Go-to-definition (F12 / Ctrl+click)** — jump directly to the ref's line. Range refs highlight the whole block.

**Diagnostics** — `to_ref:` tags with no matching UUID in `.coderef` are underlined as warnings. Commit-pinned historical refs are suppressed.

**Insert ref** — Command Palette (`Ctrl+Shift+P`) → **Coderef: Insert New ref: Anchor at Cursor**, or press `Ctrl+Shift+U`. Prompts for an optional name.

**Insert range ref** — select lines, then press `Ctrl+Shift+R` to wrap the selection with `:start` / `:end`.

**Autocomplete** — typing `to_ref:` suggests all known UUIDs with their locations and names.

### Settings

| Setting | Default | Description |
|---|---|---|
| `coderef.showInlineHints` | `true` | Show `→ file:line` hints after `to_ref:` tags |
| `coderef.diagnosticSeverity` | `"warning"` | Severity for dangling refs: `"error"`, `"warning"`, `"information"`, `"hint"` |

---

## Vim / Neovim plugin

One plugin, two runtimes. VimScript runs in both Vim 8+ and Neovim; a Lua module adds Neovim-specific enhancements.

### Install

**vim-plug:**
```vim
Plug 'erncyp/coderef', { 'rtp': 'vim-plugin' }
```

**lazy.nvim:**
```lua
{ 'erncyp/coderef', main = 'coderef', opts = {} }
```

**Manual:**
```vim
set runtimepath+=/path/to/coderef/vim-plugin
```

### Commands and mappings

| Key | Command | Description |
|---|---|---|
| `<leader>cg` | `:CoDerefGoto` | Jump to the ref under the cursor |
| `<leader>cp` | `:CoDerefPreview` | Open in preview window |
| `<leader>ci` | `:CoDerefInsert` | Insert a new `ref:` at end of line |
| `<leader>cr` | `:CoDerefInsertRange` | Wrap visual selection with `:start`/`:end` |
| `<leader>ck` | `:CoDerefInfo` | Show info card for the ref under the cursor |
| — | `:CoDerefCheck` | Run `coderef check`, load results into quickfix |

Override any mapping in your vimrc, or set `let g:coderef_no_default_maps = 1` to disable them all.

### Completion

Typing `to_ref:` and pressing `<C-x><C-o>` opens a completion menu with all known UUIDs, their locations, and names — equivalent to the VSCode autocomplete. The plugin sets `omnifunc=coderef#complete` for every buffer where no other omnifunc is configured. To opt out (e.g. when using an LSP client): `let g:coderef_set_omnifunc = 0`.

### Info card

`:CoDerefInfo` (default `<leader>ck`) shows a hover-style card for the `to_ref:` under the cursor:
- Resolved refs show UUID, name, and `file:line` (or `file:start-end` for ranges)
- Commit-pinned refs show `→ [commit] (historical)`
- Dangling refs show a warning

Neovim 0.5+ uses a floating window; Vim 8.1.1517+ uses a popup; older Vim echoes to the command line.

### Neovim extras (0.5+)

- **Virtual text** — `→ src/auth.py:14` hints after every `to_ref:`; `→ [abc1234] (historical)` for commit-pinned refs
- **Diagnostics** — dangling refs in the sign column, navigable with `]d` / `[d`
- **Lua setup** — `require('coderef').setup({ show_hints = false, info_key = 'K' })`

Run `:help coderef` for full documentation.

---

## MCP server

Exposes coderef as MCP tools so AI assistants can navigate refs natively during a session.

### Setup

```json
{
  "mcpServers": {
    "coderef": {
      "command": "python3",
      "args": ["/path/to/coderef/mcp-server/coderef_mcp.py"],
      "env": { "CODEREF_ROOT": "/path/to/your/project" }
    }
  }
}
```

### Tools

| Tool | Description |
|---|---|
| `resolve(uuid)` | Resolve a UUID to its current file and line |
| `list_refs()` | List all refs in `.coderef` |
| `read_anchor(uuid, context_lines)` | Read the source at a ref with optional surrounding context |
| `graph()` | Return the full ref→reference graph |
| `check()` | Audit ref integrity — dangling, historical, orphans |

**Requirements:** `pip install mcp` (or `pip install -r mcp-server/requirements.txt`).

---

## .coderef format

Plain text, one entry per line:

```
<uuid> <relpath>:<line>
<uuid> <relpath>:<line> <name>
<uuid> <relpath>:<startline>-<endline>
```

- `<uuid>` — 8 lowercase hex characters
- `<relpath>` — path relative to the repository root
- `<line>` — 1-indexed line number
- `<name>` — optional lowercase label (letters, digits, hyphens)

Lines starting with `#` are comments. The file is sorted by UUID for stable diffs.

---

## FAQ

**What if I move a file?**
The pre-commit hook rescans all tracked files on your next commit and updates `.coderef` automatically.

**What if I delete a `ref:`?**
The UUID disappears from `.coderef` after the next commit. Any remaining `to_ref:` tags become dangling — editors flag them and `coderef check` exits 1.

**Can two refs share the same UUID?**
The hook warns on duplicates and the last occurrence wins. Avoid duplicates by generating UUIDs with the VSCode or Vim command.

**Does this work without VSCode or Neovim?**
Yes. The hook and CLI work in any editor. `coderef resolve <uuid>` gives you the `file:line` from the terminal.

**What about nested ranges?**
Nesting works fine — each UUID is independent, so `aaaa:start … bbbb:start … bbbb:end … aaaa:end` produces two separate ranges with no conflict.

**What happens if I write the wrong UUID on a `:end` line?**
The scanner reports both sides as errors and blocks the commit:
```
error: ref:aaaa1234:start at src/auth.py:10 has no matching :end
error: ref:bbbb5678:end at src/auth.py:18 has no matching :start
```
