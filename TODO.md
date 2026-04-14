# TODO

## AI / MCP integration

- [ ] **MCP server** — expose `resolve`, `list`, and `graph` as MCP tool calls so AI assistants can navigate refs natively during a session
- [ ] **`coderef graph` command** — emit the full `to_ref → ref` relationship as JSON for AI tooling and static analysis
- [ ] **Named refs** — support `ref:a3f9c821:rate-limiter` syntax so AI (and humans) get semantic meaning without reading the target file
- [x] **Range refs** — mark a block with a start/end UUID pair (e.g. `ref:a3f9c821:start` / `ref:a3f9c821:end`) so an AI receives a whole logical unit, not just a line

## CLI

- [ ] **`coderef check` in CI** — document and example GitHub Actions workflow
- [ ] **`coderef graph` command** — see above

## VSCode extension

- [ ] **Publish to Marketplace** — set up publisher, add icon, submit to VS Code Marketplace
- [x] **Range ref support** — highlight and navigate ref ranges once range refs are implemented
- [ ] **Named ref display** — show the human-readable name in inline hints when present (e.g. `→ src/auth/middleware.py:14 (rate-limiter)`)
- [ ] **`to_ref:` autocomplete** — suggest known UUIDs (with names/locations) when typing `to_ref:`

## Git hook

- [ ] **Post-checkout / post-merge hook** — update `.refs` after pulls and branch switches, not just commits
- [ ] **Support for chaining existing hooks** — detect and chain rather than replace an existing pre-commit hook
