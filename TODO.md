# TODO

## AI / MCP integration

- [x] **MCP server** — expose `resolve`, `list`, `graph`, `check`, and `read_anchor` as MCP tool calls so AI assistants can navigate refs natively during a session
- [x] **`coderef graph` command** — emit the full `to_ref → ref` relationship as JSON for AI tooling and static analysis
- [x] **Named refs** — support `ref:a3f9c821:rate-limiter` syntax so AI (and humans) get semantic meaning without reading the target file
- [x] **Range refs** — mark a block with a start/end UUID pair (e.g. `ref:a3f9c821:start` / `ref:a3f9c821:end`) so an AI receives a whole logical unit, not just a line
- [x] **Commit-pinned `to_ref:`** — extended syntax `to_ref:@<commit>:<optional-name>:<uuid>` (the `@` sigil unambiguously marks a commit) lets authors cite code at a specific point in history without breaking CI; `coderef check` distinguishes dangling errors from intentional historical references

## CLI

- [x] **`coderef check` in CI** — GitHub Actions workflow at `.github/workflows/coderef-check.yml`
- [x] **`coderef graph` command** — see above
- [x] **`coderef scan`** — update `.coderef` on demand without a git commit; `--dry-run` shows changes
- [x] **`coderef check --strict`** — orphan detection (anchors never referenced by any `to_ref:`)
- [x] **`coderef resolve --context N`** — show N lines of source around the anchor

## Web traversal (GitHub / GitLab)

Ideas for navigating `ref:` / `to_ref:` anchors while browsing code on the web:

- [ ] **Browser extension** — intercept GitHub/GitLab file-view pages, read the repo's raw `.coderef` file via the GitHub/GitLab API, and inject inline hints next to every `to_ref:` tag (similar to the VSCode extension's decorations); Ctrl+click jumps to the resolved file/line permalink
- [ ] **GitHub App** — server-side integration that runs `coderef check` as a commit status check and posts inline PR review comments on any new dangling `to_ref:` references introduced in the diff
- [ ] **Permalink resolver** — a lightweight HTTP redirect service (or GitHub Action artefact) that accepts `coderef://<repo>/<uuid>` and redirects to the exact GitHub permalink (`/blob/<sha>/file#Lline`) by reading `.coderef` at that commit; useful for linking to stable anchors from docs, wikis, and issue trackers
- [ ] **Static-site / documentation plugin** — a plugin for MkDocs, Docusaurus, or similar that resolves `to_ref:` links in Markdown docs to permanent GitHub permalink URLs at the current commit, so published docs never have stale line-number links

## VSCode extension

- [ ] **Publish to Marketplace** — set up publisher, add icon, submit to VS Code Marketplace
- [x] **Range ref support** — highlight and navigate ref ranges once range refs are implemented
- [x] **Named ref display** — inline hints and hover show the human-readable name when present
- [x] **`to_ref:` autocomplete** — suggests known UUIDs (with names and locations) when typing `to_ref:`

## Git hook

- [x] **Post-checkout / post-merge hook** — update `.coderef` after pulls and branch switches
- [x] **Support for chaining existing hooks** — `install.sh` detects and chains rather than replaces

## Performance

- [ ] **Incremental scan** — on pre-commit, only rescan files changed in the current commit (`git diff --cached --name-only`) instead of all tracked files; fall back to full scan if `.coderef` is absent
- [ ] **Rust rewrite** — replace the Python hook and CLI with a single native binary for near-zero startup latency and parallel file scanning via Rayon; the I/O-bound scan would benefit most in large monorepos (10k+ files); the Python implementation is the right starting point — profile before porting
