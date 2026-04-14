# TODO

## AI / MCP integration

- [x] **MCP server** — expose `resolve`, `list`, `graph`, `check`, and `read_anchor` as MCP tool calls so AI assistants can navigate refs natively during a session
- [x] **`coderef graph` command** — emit the full `to_ref → ref` relationship as JSON for AI tooling and static analysis
- [x] **Named refs** — support `ref:a3f9c821:rate-limiter` syntax so AI (and humans) get semantic meaning without reading the target file
- [x] **Range refs** — mark a block with a start/end UUID pair (e.g. `ref:a3f9c821:start` / `ref:a3f9c821:end`) so an AI receives a whole logical unit, not just a line

## CLI

- [x] **`coderef check` in CI** — GitHub Actions workflow at `.github/workflows/coderef-check.yml`
- [x] **`coderef graph` command** — see above
- [x] **`coderef scan`** — update `.refs` on demand without a git commit; `--dry-run` shows changes
- [x] **`coderef check --strict`** — orphan detection (anchors never referenced by any `to_ref:`)
- [x] **`coderef resolve --context N`** — show N lines of source around the anchor

## VSCode extension

- [ ] **Publish to Marketplace** — set up publisher, add icon, submit to VS Code Marketplace
- [x] **Range ref support** — highlight and navigate ref ranges once range refs are implemented
- [x] **Named ref display** — inline hints and hover show the human-readable name when present
- [x] **`to_ref:` autocomplete** — suggests known UUIDs (with names and locations) when typing `to_ref:`

## Git hook

- [x] **Post-checkout / post-merge hook** — update `.refs` after pulls and branch switches
- [x] **Support for chaining existing hooks** — `install.sh` detects and chains rather than replaces
