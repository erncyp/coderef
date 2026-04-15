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
- [x] **pre-commit framework plugin** — `.pre-commit-hooks.yaml` + `pyproject.toml` expose `coderef-scan` and `coderef-check` hooks; install with `pip install .` or via pre-commit's `language: python`
- [x] **Range validation errors** — mismatched `:start`/`:end` pairs and cross-file ranges now exit 1 in both the git hook and `coderef scan`/`coderef check`; duplicate UUIDs remain warnings

## Cross-repo references

Ideas for `to_ref:` references that point into a *different* repository:

- [ ] **Design the syntax** — `/` in a source name is unambiguous from UUIDs and the `@` sigil, so `to_ref:myorg/other-repo:uuid` and `to_ref:@abc1234:myorg/other-repo:uuid` are natural candidates; needs validation against real use cases (microservices, lib → app, docs → code)
- [ ] **Sources block in `.coderef`** — a `source <name> <url>` header section declares remote repos; `coderef fetch` pulls their `.coderef` files and caches the entries locally; analogous to `package.json` + `npm install`
- [ ] **Lock file (`.coderef.lock`)** — `coderef fetch` writes a lock file that pins the exact commit SHA and inlines the resolved remote entries; committed to the repo so CI and teammates don't need network access; `coderef fetch --update` refreshes it; analogous to `package-lock.json`
- [ ] **Simple inline fallback** — before building fetching infrastructure, remote entries can be copied manually into `.coderef` with a URL as the location (e.g. `b7d2e104 https://github.com/org/repo/blob/abc1234/src/api.py#L42`); the VSCode extension and CLI open the URL on navigate



Ideas for navigating `ref:` / `to_ref:` anchors while browsing code on the web:

- [ ] **Browser extension** — intercept GitHub/GitLab file-view pages, read the repo's raw `.coderef` file via the GitHub/GitLab API, and inject inline hints next to every `to_ref:` tag (similar to the VSCode extension's decorations); Ctrl+click jumps to the resolved file/line permalink
- [ ] **GitHub App** — server-side integration that runs `coderef check` as a commit status check and posts inline PR review comments on any new dangling `to_ref:` references introduced in the diff
- [ ] **Permalink resolver** — a lightweight HTTP redirect service (or GitHub Action artefact) that accepts `coderef://<repo>/<uuid>` and redirects to the exact GitHub permalink (`/blob/<sha>/file#Lline`) by reading `.coderef` at that commit; useful for linking to stable anchors from docs, wikis, and issue trackers
- [ ] **Static-site / documentation plugin** — a plugin for MkDocs, Docusaurus, or similar that resolves `to_ref:` links in Markdown docs to permanent GitHub permalink URLs at the current commit, so published docs never have stale line-number links

## Vim / Neovim plugin

- [x] **Core plugin** — VimScript plugin (`vim-plugin/`) works in Vim 8+ and Neovim; go-to-definition, preview window, insert anchor, insert range, quickfix check
- [x] **Neovim virtual text** — Lua module adds `→ file:line` hints, commit-pin badges, and native `vim.diagnostic` warnings for dangling refs on Neovim 0.5+
- [x] **Lua setup API** — `require('coderef').setup({})` for lazy.nvim / Neovim-native config
- [ ] **Publish to Vim/Neovim package registries** — submit to vim.org scripts and add to awesome-neovim list



- [ ] **Publish to Marketplace** — set up publisher, add icon, submit to VS Code Marketplace
- [x] **Range ref support** — highlight and navigate ref ranges once range refs are implemented
- [x] **Named ref display** — inline hints and hover show the human-readable name when present
- [x] **`to_ref:` autocomplete** — suggests known UUIDs (with names and locations) when typing `to_ref:`

## Git hook

- [x] **Post-checkout / post-merge hook** — update `.coderef` after pulls and branch switches
- [x] **Support for chaining existing hooks** — `install.sh` detects and chains rather than replaces

## .coderef storage strategy

Whether `.coderef` should be committed to the repository at all is an open question. Three options:

- [ ] **Commit `.coderef` (current approach)** — instant reads, no scan on every resolve/check, works offline and in CI without extra setup; downside is git noise (every file move or line-number shift produces a diff)
- [ ] **Gitignore `.coderef`, scan on demand** — no git noise; `.coderef` is a local cache regenerated by `coderef scan` (or the post-checkout hook); CI must run `coderef scan` before `coderef check`; editors need it present to show hints
- [ ] **No `.coderef` file at all — pure grep** — `coderef resolve` greps the working tree directly; zero git noise, nothing to install; downside is O(files) latency on every resolve and no way to detect dangling `to_ref:` without a full scan anyway

Considerations: the pure-grep approach makes the CLI slower in large repos; the gitignore approach keeps the speed benefit but requires a generation step in CI; committing keeps everything simple at the cost of noisy diffs.

## Performance

- [ ] **Incremental scan** — on pre-commit, only rescan files changed in the current commit (`git diff --cached --name-only`) instead of all tracked files; fall back to full scan if `.coderef` is absent
- [ ] **Rust rewrite** — replace the Python hook and CLI with a single native binary for near-zero startup latency and parallel file scanning via Rayon; the I/O-bound scan would benefit most in large monorepos (10k+ files); the Python implementation is the right starting point — profile before porting
