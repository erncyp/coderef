# coderef

Stable UUID-based code anchors that survive renames, moves, and refactors.

Embed a `ref:` anchor anywhere in source code. Reference it from elsewhere with `to_ref:`. A git hook keeps a `.coderef` mapping file up to date with the current location of every anchor. A VSCode extension turns `to_ref:` tags into clickable, hoverable navigation.

```python
# src/auth/middleware.py

def check_token(request):
    # ref:a3f9c821  ← anchor lives here
    ...
```

```python
# src/api/routes.py

# Token validation logic: see to_ref:a3f9c821  ← click to jump there
```

---

## How it works

| Piece | Role |
|---|---|
| `ref:<uuid>` | Marks a location as a stable anchor |
| `to_ref:<uuid>` | References that anchor from anywhere |
| `.coderef` | Maps each UUID to its current `file:line` |
| `hooks/pre-commit` | Rewrites `.coderef` on every commit |
| `cli/coderef` | CLI for resolving refs and checking for broken ones |
| `vscode-extension/` | Inline hints, hover, go-to-definition, diagnostics |

UUIDs are 8-character lowercase hex strings (e.g. `a3f9c821`). They are language-agnostic — any file type that supports comments works.

---

## Installation

### 1. Clone this repo

```bash
git clone https://github.com/erncyp/coderef.git
```

### 2. Install the git hook into your project

From inside your project's directory:

```bash
/path/to/coderef/install.sh
```

Or use the CLI:

```bash
cd /your/project
/path/to/coderef/cli/coderef install
```

This copies `hooks/pre-commit` into your project's `.git/hooks/` and creates an empty `.coderef` file if one doesn't exist. Any existing pre-commit hook is backed up as `pre-commit.bak`.

**Requirements:** Python 3.9+ on `PATH`.

### 3. Commit `.coderef` to your repository

```bash
git add .coderef
git commit -m "add coderef .coderef"
```

From now on, every `git commit` automatically updates `.coderef`.

---

## Usage

### Marking an anchor

Add `ref:<uuid>` anywhere in a comment. Use the VSCode command (see below) to generate one, or pick any 8 hex characters yourself:

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

### Referencing an anchor

Use `to_ref:<uuid>` anywhere — in source, docs, commit messages, or issue trackers:

```python
# Delegates to the JWT verifier: see to_ref:a3f9c821
result = auth.check(request)
```

### After committing

The pre-commit hook updates `.coderef` automatically:

```
a3f9c821 src/auth/middleware.py:14
b7d2e104 src/api/server.ts:42
c9f01a3d db/migrations/003_indexes.sql:7
```

---

## CLI

```bash
coderef <command>
```

Add `cli/` to your `PATH`, or invoke as `/path/to/coderef/cli/coderef`.

| Command | Description |
|---|---|
| `coderef resolve <uuid>` | Print the current `file:line` for a UUID |
| `coderef list` | List all UUIDs and their locations |
| `coderef check` | Report dangling `to_ref:` references; exits 1 if any found |
| `coderef install` | Install the pre-commit hook into the current repo |

### Examples

```bash
$ coderef resolve a3f9c821
src/auth/middleware.py:14

$ coderef list
a3f9c821  src/auth/middleware.py:14
b7d2e104  src/api/server.ts:42

$ coderef check
ok: no dangling refs (2 anchor(s) in .coderef)

# Dangling ref example:
$ coderef check
src/api/routes.py:31: dangling to_ref:deadbeef
# exits with code 1
```

### CI integration

Add `coderef check` to your CI pipeline to catch broken references before they merge:

```yaml
# GitHub Actions example
- name: Check coderef integrity
  run: python3 /path/to/coderef/cli/coderef check
```

---

## VSCode Extension

### Install

**From source (VSIX):**

```bash
cd vscode-extension
npm install
npm run compile
npx vsce package          # produces coderef-0.1.0.vsix
code --install-extension coderef-0.1.0.vsix
```

**Requirements:** Node.js 18+, npm.

### Features

**Inline hints**

Every `to_ref:<uuid>` gets a subtle annotation showing the resolved location:

```
# see to_ref:a3f9c821  → src/auth/middleware.py:14
```

**Hover**

Hover over any `to_ref:<uuid>` to see a card with the file path and a clickable link that opens it at the exact line. Hovering a dangling reference shows a warning instead.

**Go-to-definition (F12 / Ctrl+click)**

Press F12 or Ctrl+click on any `to_ref:<uuid>` to jump directly to the anchor's line.

**Dangling ref diagnostics**

`to_ref:` tags whose UUID is not in `.coderef` are underlined as warnings. The severity is configurable.

**Insert anchor command**

Open the Command Palette (`Ctrl+Shift+P`) and run **Coderef: Insert New ref: Anchor at Cursor**, or press `Ctrl+Shift+U` (`Cmd+Shift+U` on Mac). This generates a new UUID and appends the correct comment syntax for the current language at the end of the line.

### Settings

| Setting | Default | Description |
|---|---|---|
| `coderef.showInlineHints` | `true` | Show `→ file:line` hints after `to_ref:` tags |
| `coderef.diagnosticSeverity` | `"warning"` | Severity for dangling refs: `"error"`, `"warning"`, `"information"`, `"hint"` |

---

## .coderef file format

Plain text, one entry per line:

```
<uuid> <relpath>:<line>
```

- `<uuid>` — 8 lowercase hex characters
- `<relpath>` — path relative to the repository root
- `<line>` — 1-indexed line number

Lines starting with `#` are comments and are ignored. The file is sorted by UUID for stable diffs.

---

## Syntax reference

| Syntax | Purpose |
|---|---|
| `ref:a3f9c821` | Declare a stable anchor at this location |
| `to_ref:a3f9c821` | Reference an anchor from anywhere |

Both tags are language-agnostic and can appear inside any comment style. The patterns work in source files, Markdown, config files, commit messages, and issue descriptions.

---

## FAQ

**What if I move a file?**
The pre-commit hook rescans all tracked files on your next commit and updates `.coderef` with the new path automatically.

**What if I delete a `ref:` anchor?**
The UUID disappears from `.coderef` after the next commit. Any remaining `to_ref:` tags pointing to it become dangling references — the VSCode extension flags them and `coderef check` exits 1.

**Can two anchors share the same UUID?**
The pre-commit hook warns on duplicates (stderr). The last occurrence wins in `.coderef`. Avoid duplicates by always generating UUIDs with the VSCode command or a random generator.

**Does this work without VSCode?**
Yes. The hook and CLI work in any editor. `coderef resolve <uuid>` gives you the file:line from the terminal.
