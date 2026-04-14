#!/usr/bin/env python3
"""
coderef MCP server

Exposes coderef functionality as MCP tools so AI assistants can navigate
UUID-based code anchors, read source blocks, and audit ref integrity without
grepping through the codebase manually.

Configuration
─────────────
Set CODEREF_ROOT to the repository root before starting the server.
If unset, the server walks up from the current working directory looking
for a .coderef file.

Claude Desktop  (~/.config/claude/claude_desktop_config.json on Linux,
                  ~/Library/Application Support/Claude/... on macOS)
──────────────
{
  "mcpServers": {
    "coderef": {
      "command": "python3",
      "args": ["/path/to/coderef/mcp-server/coderef_mcp.py"],
      "env": {
        "CODEREF_ROOT": "/path/to/your/project"
      }
    }
  }
}

Claude Code
───────────
Add to your project's .claude/settings.json:
{
  "mcpServers": {
    "coderef": {
      "command": "python3",
      "args": ["/path/to/coderef/mcp-server/coderef_mcp.py"],
      "env": { "CODEREF_ROOT": "${workspaceFolder}" }
    }
  }
}
"""
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# ── Patterns ──────────────────────────────────────────────────────────────────

REF_MARKER_RE = re.compile(
    r'(?<![a-zA-Z_])ref:([a-f0-9]{8})(?::(start|end|[a-z][a-z0-9-]*))?(?![a-f0-9:])'
)
TO_REF_RE = re.compile(r'\bto_ref:((?:[-A-Za-z0-9._/@]+:)*[a-f0-9]{8})(?![a-f0-9:])')

REFS_FILENAME = ".coderef"


# ── to_ref: body parser ───────────────────────────────────────────────────────

def _is_commit_ref(s: str) -> bool:
    """Heuristic: decide whether a to_ref: prefix segment is a commit/branch/tag."""
    if s == "HEAD":
        return True
    if re.match(r'^[0-9a-f]+$', s) and len(s) != 8 and 7 <= len(s) <= 40:
        return True
    if "/" in s or "." in s:
        return True
    if any(c.isupper() for c in s):
        return True
    if s and s[0].isdigit():
        return True
    return False


def _parse_to_ref(body: str) -> dict:
    """
    Parse the body captured after ``to_ref:`` by TO_REF_RE.

    Returns {'uuid': str, 'commit': str|None, 'name': str|None}.
    """
    parts = body.split(":")
    uuid = parts[-1]
    commit: str | None = None
    name:   str | None = None

    if len(parts) == 2:
        seg = parts[0]
        if _is_commit_ref(seg):
            commit = seg
        else:
            name = seg
    elif len(parts) >= 3:
        commit = parts[0]
        name   = ":".join(parts[1:-1])

    return {"uuid": uuid, "commit": commit, "name": name}


# ── Data ──────────────────────────────────────────────────────────────────────

@dataclass
class RefInfo:
    location: str          # "file:line" or "file:start-end"
    kind: str              # "point" | "range"
    name: str | None = None

    @property
    def file(self) -> str:
        return self.location.rsplit(":", 1)[0]

    @property
    def start_line(self) -> int:
        return int(self.location.rsplit(":", 1)[1].split("-")[0])

    @property
    def end_line(self) -> int | None:
        parts = self.location.rsplit(":", 1)[1].split("-")
        return int(parts[1]) if len(parts) == 2 else None

    def as_dict(self, uuid: str) -> dict:
        d: dict = {
            "uuid": uuid,
            "file": self.file,
            "line": self.start_line,
            "kind": self.kind,
            "location": self.location,
        }
        if self.end_line is not None:
            d["end_line"] = self.end_line
        if self.name:
            d["name"] = self.name
        return d

# ── Repo root resolution ──────────────────────────────────────────────────────

def find_root() -> Path:
    # 1. Explicit env var
    env_root = os.environ.get("CODEREF_ROOT")
    if env_root:
        return Path(env_root).resolve()

    # 2. git rev-parse from cwd
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            return Path(result.stdout.strip())
    except FileNotFoundError:
        pass

    # 3. Walk up from cwd looking for .coderef
    cur = Path.cwd()
    while True:
        if (cur / REFS_FILENAME).exists():
            return cur
        parent = cur.parent
        if parent == cur:
            break
        cur = parent

    return Path.cwd()


ROOT = find_root()

# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_refs_line(raw: str) -> tuple[str, str, str | None]:
    """Return (location, kind, name_or_None) for a .coderef value string."""
    parts = raw.rsplit(None, 1)
    name: str | None = None
    location = raw
    if len(parts) == 2 and re.match(r'^[a-z][a-z0-9-]*$', parts[1]):
        if re.search(r':\d+(-\d+)?$', parts[0]):
            location, name = parts[0], parts[1]
    kind = "range" if re.search(r':\d+-\d+$', location) else "point"
    return location, kind, name


def load_refs() -> dict[str, RefInfo]:
    refs_path = ROOT / REFS_FILENAME
    if not refs_path.exists():
        return {}
    refs: dict[str, RefInfo] = {}
    for line in refs_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if len(parts) == 2:
            uuid, raw = parts
            location, kind, name = _parse_refs_line(raw)
            refs[uuid] = RefInfo(location=location, kind=kind, name=name)
    return refs


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"], capture_output=True, text=True, cwd=ROOT
    )
    return result.stdout.splitlines() if result.returncode == 0 else []


def scan_to_refs(files: list[str]) -> dict[str, list[dict]]:
    """Returns {uuid: [{file, line[, commit][, name]}, ...]}."""
    result: dict[str, list[dict]] = {}
    for rel in files:
        full = ROOT / rel
        if not full.is_file():
            continue
        try:
            text = full.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for m in TO_REF_RE.finditer(line):
                parsed = _parse_to_ref(m.group(1))
                uuid = parsed["uuid"]
                occ: dict = {"file": rel, "line": lineno}
                if parsed["commit"]:
                    occ["commit"] = parsed["commit"]
                if parsed["name"]:
                    occ["name"] = parsed["name"]
                result.setdefault(uuid, []).append(occ)
    return result


def read_source(rel_path: str, start: int, end: int | None = None) -> str:
    """Return source lines start..end (1-indexed, inclusive) from a file."""
    full = ROOT / rel_path
    try:
        lines = full.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return f"(could not read {rel_path})"
    stop = (end or start)
    return "\n".join(lines[start - 1 : stop])

# ── MCP server ────────────────────────────────────────────────────────────────

mcp = FastMCP(
    "coderef",
    instructions=(
        "Use these tools to navigate stable UUID-based code anchors in the "
        "repository. Start with list_refs() to see all anchors, then "
        "read_anchor(uuid) to fetch the actual source code at any anchor. "
        f"Repository root: {ROOT}"
    ),
)


@mcp.tool()
def resolve(uuid: str) -> dict:
    """
    Resolve a coderef UUID to its current file location.

    Returns the file path, line number(s), kind (point or range), and
    optional human-readable name. Use read_anchor() to also get the
    source code at that location.
    """
    refs = load_refs()
    if uuid not in refs:
        return {"error": f"UUID '{uuid}' not found in .coderef", "uuid": uuid}
    return refs[uuid].as_dict(uuid)


@mcp.tool()
def list_refs() -> list[dict]:
    """
    List all ref: anchors registered in .coderef.

    Returns a list of entries, each with uuid, file, line, kind, and
    optional name. Use read_anchor(uuid) to fetch the source code for
    any entry.
    """
    refs = load_refs()
    return [info.as_dict(uuid) for uuid, info in sorted(refs.items())]


@mcp.tool()
def read_anchor(uuid: str, context_lines: int = 0) -> dict:
    """
    Read the source code at a ref: anchor.

    For range refs, returns the complete source block between :start and :end.
    For point refs, returns that single line.
    context_lines adds that many lines of surrounding context on each side.

    This is the primary tool for understanding what a to_ref: reference
    actually points to without opening the file manually.
    """
    refs = load_refs()
    if uuid not in refs:
        return {"error": f"UUID '{uuid}' not found in .coderef", "uuid": uuid}

    info = refs[uuid]
    start = info.start_line
    end   = info.end_line or start
    ctx   = max(0, context_lines)

    full_path = ROOT / info.file
    try:
        all_lines = full_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return {"error": f"Could not read {info.file}", **info.as_dict(uuid)}

    total      = len(all_lines)
    view_start = max(1, start - ctx)
    view_end   = min(total, end + ctx)

    # Build annotated content: mark anchor lines with a leading `>`
    content_lines = []
    for n in range(view_start, view_end + 1):
        marker = ">" if start <= n <= end else " "
        content_lines.append(f"{marker} {n:4d}: {all_lines[n - 1]}")

    result = info.as_dict(uuid)
    result["content"] = "\n".join(content_lines)
    result["content_lines"] = {"from": view_start, "to": view_end}
    return result


@mcp.tool()
def graph() -> dict:
    """
    Return the complete anchor→reference graph.

    Each key is a UUID. Each value contains the anchor's location and a
    list of every to_ref: occurrence in the codebase that points to it.
    Dangling to_ref: UUIDs (no anchor in .coderef) are included and flagged.

    Useful for understanding which parts of the codebase are most
    interconnected and for finding all callers/readers of a given anchor.
    """
    refs    = load_refs()
    files   = tracked_files()
    to_refs = scan_to_refs(files)

    result: dict[str, dict] = {}

    for uuid, info in sorted(refs.items()):
        entry = info.as_dict(uuid)
        entry["referenced_by"] = to_refs.get(uuid, [])
        result[uuid] = entry

    for uuid, occurrences in sorted(to_refs.items()):
        if uuid not in result:
            result[uuid] = {
                "uuid": uuid,
                "location": None,
                "kind": None,
                "referenced_by": occurrences,
                "dangling": True,
            }

    return result


@mcp.tool()
def check() -> dict:
    """
    Audit ref integrity across the codebase.

    Returns:
      dangling   — to_ref: UUIDs with no commit pin and no anchor in .coderef (errors)
      historical — to_ref: UUIDs pinned to a specific commit, not in current .coderef (informational)
      orphans    — ref: anchors in .coderef that no to_ref: points to
      ok         — True only when dangling and orphans are both empty

    Run this to verify the codebase is in a consistent state, e.g. after
    a merge or before a release.
    """
    refs    = load_refs()
    files   = tracked_files()
    to_refs = scan_to_refs(files)

    dangling   = []
    historical = []
    for uuid, occurrences in sorted(to_refs.items()):
        for occ in occurrences:
            commit = occ.get("commit")
            is_pinned = commit is not None and commit != "HEAD"
            if uuid not in refs:
                if is_pinned:
                    historical.append({"uuid": uuid, **occ})
                else:
                    dangling.append({"uuid": uuid, **occ})

    referenced = set(to_refs.keys())
    orphans = [
        info.as_dict(uuid)
        for uuid, info in sorted(refs.items())
        if uuid not in referenced
    ]

    return {
        "ok": not dangling and not orphans,
        "dangling": dangling,
        "historical": historical,
        "orphans": orphans,
        "summary": {
            "total_anchors": len(refs),
            "dangling_count": len(dangling),
            "historical_count": len(historical),
            "orphan_count": len(orphans),
        },
    }


if __name__ == "__main__":
    mcp.run()
