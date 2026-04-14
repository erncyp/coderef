#!/usr/bin/env bash
# Install the coderef pre-commit hook into the current (or specified) git repo.
#
# Usage:
#   ./install.sh              # install into cwd's git repo
#   ./install.sh /path/to/repo

set -euo pipefail

CODEREF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-$(pwd)}"

# Resolve the git root of the target directory
REPO_ROOT="$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: '$TARGET_DIR' is not inside a git repository" >&2
  exit 1
}

HOOK_SRC="$CODEREF_DIR/hooks/pre-commit"
HOOK_DST="$REPO_ROOT/.git/hooks/pre-commit"

# Back up existing hook if present
if [[ -f "$HOOK_DST" ]]; then
  echo "coderef: backing up existing hook to $HOOK_DST.bak"
  cp "$HOOK_DST" "$HOOK_DST.bak"
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
echo "coderef: hook installed at $HOOK_DST"

# Create .refs if it doesn't exist
REFS_FILE="$REPO_ROOT/.refs"
if [[ ! -f "$REFS_FILE" ]]; then
  touch "$REFS_FILE"
  echo "coderef: created empty .refs at $REFS_FILE"
fi

echo "coderef: installation complete"
