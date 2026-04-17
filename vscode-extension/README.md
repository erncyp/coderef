# Coderef

Stable UUID-based code anchors that survive renames, moves, and refactors. Place a `ref:` anywhere; reference it from anywhere else with `to_ref:`.

## Commands

| Keybinding | Mac | Command |
|---|---|---|
| `Ctrl+Alt+U` | `Cmd+Shift+U` | Insert `ref:` anchor at cursor |
| `Ctrl+Alt+R` | `Cmd+Shift+R` | Wrap selection with `ref:start` / `ref:end` |
| `Ctrl+Alt+J` | `Cmd+Shift+J` | Pick a ref and insert as `to_ref:` at cursor |

Both commands also appear in the Command Palette (`Ctrl+Shift+P`) as **Coderef: Insert New ref: Anchor at Cursor** and **Coderef: Insert Range ref: Anchor (start/end)**.

After inserting, the extension runs `coderef scan` automatically so the new anchor is immediately resolvable — no commit required.

## Features

- **Inline hints** — `to_ref:a3f9c821` gets a `→ src/auth/middleware.py:14` annotation
- **Hover** — file path, line, and clickable link; commit-pinned refs show their commit badge
- **Go-to-definition** (`F12` / `Ctrl+Click`) — jumps to the ref's line; range refs highlight the block
- **Diagnostics** — dangling `to_ref:` tags are underlined; commit-pinned historical refs are suppressed
- **Autocomplete** — `Ctrl+Space` after `to_ref:` suggests all known UUIDs with names and locations (note: VS Code disables quick suggestions in comments by default — use `Ctrl+Alt+J` instead)

## Requirements

- `coderef` on your `PATH` (needed for auto-scan and autocomplete)
- A `.coderef` file at the workspace root — created automatically on first scan

See [github.com/erncyp/coderef](https://github.com/erncyp/coderef) for installation.

## Settings

| Setting | Default | Description |
|---|---|---|
| `coderef.showInlineHints` | `true` | Show `→ file:line` hints after `to_ref:` tags |
| `coderef.diagnosticSeverity` | `"warning"` | Severity for dangling refs: `"error"`, `"warning"`, `"information"`, `"hint"` |

## to_ref: syntax

| Form | Meaning |
|---|---|
| `to_ref:a3f9c821` | Reference at HEAD |
| `to_ref:rate-limiter:a3f9c821` | Labelled reference |
| `to_ref:@abc1234:a3f9c821` | Pinned to a specific commit (never flagged as dangling) |
