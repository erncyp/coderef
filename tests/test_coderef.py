"""Tests for coderef_core — pure-function and temp-file based."""
import pytest
from pathlib import Path

from coderef_core import (
    RefInfo,
    _is_ignored,
    _parse_refs_line,
    _parse_to_ref,
    load_refs,
    scan_anchors,
    scan_to_refs,
)


# ── _parse_to_ref ─────────────────────────────────────────────────────────────

class TestParseToRef:
    def test_uuid_only(self):
        assert _parse_to_ref("a3f9c821") == {"uuid": "a3f9c821", "commit": None, "name": None}

    def test_named(self):
        assert _parse_to_ref("auth-guard:a3f9c821") == {
            "uuid": "a3f9c821", "commit": None, "name": "auth-guard"
        }

    def test_commit_pinned(self):
        assert _parse_to_ref("@abc1234:a3f9c821") == {
            "uuid": "a3f9c821", "commit": "abc1234", "name": None
        }

    def test_commit_and_name(self):
        assert _parse_to_ref("@abc1234:rate-limiter:a3f9c821") == {
            "uuid": "a3f9c821", "commit": "abc1234", "name": "rate-limiter"
        }

    def test_commit_branch_name(self):
        result = _parse_to_ref("@main:a3f9c821")
        assert result["commit"] == "main"
        assert result["uuid"] == "a3f9c821"


# ── _parse_refs_line ──────────────────────────────────────────────────────────

class TestParseRefsLine:
    def test_point(self):
        loc, kind, name = _parse_refs_line("src/auth.py:14")
        assert loc == "src/auth.py:14"
        assert kind == "point"
        assert name is None

    def test_point_named(self):
        loc, kind, name = _parse_refs_line("src/auth.py:14 auth-guard")
        assert loc == "src/auth.py:14"
        assert kind == "point"
        assert name == "auth-guard"

    def test_range(self):
        loc, kind, name = _parse_refs_line("src/auth.py:10-20")
        assert loc == "src/auth.py:10-20"
        assert kind == "range"
        assert name is None

    def test_range_named(self):
        loc, kind, name = _parse_refs_line("src/auth.py:10-20 rate-limiter")
        assert loc == "src/auth.py:10-20"
        assert kind == "range"
        assert name == "rate-limiter"


# ── RefInfo properties ────────────────────────────────────────────────────────

class TestRefInfo:
    def test_start_line_point(self):
        r = RefInfo(location="src/auth.py:14", kind="point")
        assert r.start_line == 14
        assert r.end_line is None

    def test_start_end_range(self):
        r = RefInfo(location="src/auth.py:10-20", kind="range")
        assert r.start_line == 10
        assert r.end_line == 20

    def test_display_no_name(self):
        r = RefInfo(location="src/auth.py:14", kind="point")
        assert r.display == "src/auth.py:14"

    def test_display_named(self):
        r = RefInfo(location="src/auth.py:14", kind="point", name="auth-guard")
        assert r.display == "src/auth.py:14 (auth-guard)"

    def test_file(self):
        r = RefInfo(location="src/auth.py:14", kind="point")
        assert r.file == "src/auth.py"


# ── _is_ignored ───────────────────────────────────────────────────────────────

class TestIsIgnored:
    def test_glob_extension(self):
        from coderef_core import _is_ignored
        assert _is_ignored("docs/api.md", ["*.md"])
        assert not _is_ignored("src/api.py", ["*.md"])

    def test_directory_prefix(self):
        from coderef_core import _is_ignored
        assert _is_ignored("vim-plugin/doc/coderef.txt", ["vim-plugin/"])

    def test_filename_match(self):
        from coderef_core import _is_ignored
        assert _is_ignored("some/path/secret.txt", ["secret.txt"])

    def test_no_patterns(self):
        from coderef_core import _is_ignored
        assert not _is_ignored("src/anything.py", [])


# ── load_refs ─────────────────────────────────────────────────────────────────

class TestLoadRefs:
    def test_empty_file(self, tmp_path):
        (tmp_path / ".coderef").write_text("")
        assert load_refs(tmp_path) == {}

    def test_missing_file(self, tmp_path):
        assert load_refs(tmp_path) == {}

    def test_point_ref(self, tmp_path):
        (tmp_path / ".coderef").write_text("a3f9c821 src/auth.py:14\n")
        refs = load_refs(tmp_path)
        assert "a3f9c821" in refs
        assert refs["a3f9c821"].location == "src/auth.py:14"
        assert refs["a3f9c821"].kind == "point"
        assert refs["a3f9c821"].name is None

    def test_named_ref(self, tmp_path):
        (tmp_path / ".coderef").write_text("a3f9c821 src/auth.py:14 auth-guard\n")
        refs = load_refs(tmp_path)
        assert refs["a3f9c821"].name == "auth-guard"

    def test_range_ref(self, tmp_path):
        (tmp_path / ".coderef").write_text("a3f9c821 src/auth.py:10-20\n")
        refs = load_refs(tmp_path)
        assert refs["a3f9c821"].kind == "range"
        assert refs["a3f9c821"].start_line == 10
        assert refs["a3f9c821"].end_line == 20

    def test_comments_ignored(self, tmp_path):
        (tmp_path / ".coderef").write_text("# this is a comment\na3f9c821 src/auth.py:14\n")
        refs = load_refs(tmp_path)
        assert len(refs) == 1

    def test_multiple_refs(self, tmp_path):
        (tmp_path / ".coderef").write_text(
            "a3f9c821 src/auth.py:14\nb7d2e104 src/api.py:42-49\n"
        )
        refs = load_refs(tmp_path)
        assert len(refs) == 2


# ── scan_anchors ──────────────────────────────────────────────────────────────

class TestScanAnchors:
    def test_point_ref(self, tmp_path):
        (tmp_path / "foo.py").write_text("# ref:a3f9c821\n")
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert "a3f9c821" in refs
        assert refs["a3f9c821"].kind == "point"
        assert refs["a3f9c821"].location == "foo.py:1"
        assert errors == []

    def test_named_ref(self, tmp_path):
        (tmp_path / "foo.py").write_text("# ref:a3f9c821:auth-guard\n")
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert refs["a3f9c821"].name == "auth-guard"

    def test_range_ref(self, tmp_path):
        (tmp_path / "foo.py").write_text(
            "# ref:a3f9c821:start\nsome code\n# ref:a3f9c821:end\n"
        )
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert refs["a3f9c821"].kind == "range"
        assert refs["a3f9c821"].location == "foo.py:1-3"
        assert errors == []

    def test_missing_end(self, tmp_path):
        (tmp_path / "foo.py").write_text("# ref:a3f9c821:start\n")
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert "a3f9c821" not in refs
        assert len(errors) == 1
        assert ":start" in errors[0]

    def test_missing_start(self, tmp_path):
        (tmp_path / "foo.py").write_text("# ref:a3f9c821:end\n")
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert "a3f9c821" not in refs
        assert len(errors) == 1
        assert ":end" in errors[0]

    def test_cross_file_range(self, tmp_path):
        (tmp_path / "a.py").write_text("# ref:a3f9c821:start\n")
        (tmp_path / "b.py").write_text("# ref:a3f9c821:end\n")
        refs, errors = scan_anchors(tmp_path, ["a.py", "b.py"])
        assert "a3f9c821" not in refs
        assert len(errors) == 1
        assert "crosses files" in errors[0]

    def test_nested_ranges(self, tmp_path):
        (tmp_path / "foo.py").write_text(
            "# ref:aaaa1234:start\n"
            "# ref:bbbb5678:start\n"
            "code\n"
            "# ref:bbbb5678:end\n"
            "# ref:aaaa1234:end\n"
        )
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert "aaaa1234" in refs
        assert "bbbb5678" in refs
        assert errors == []

    def test_skips_coderef_file(self, tmp_path):
        (tmp_path / ".coderef").write_text("a3f9c821 foo.py:1\n")
        refs, errors = scan_anchors(tmp_path, [".coderef"])
        assert refs == {}

    def test_not_matched_inside_word(self, tmp_path):
        (tmp_path / "foo.py").write_text("# xref:a3f9c821\n")
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert refs == {}

    def test_multiple_refs_on_one_line(self, tmp_path):
        (tmp_path / "foo.py").write_text("# ref:a3f9c821  ref:b7d2e104\n")
        refs, errors = scan_anchors(tmp_path, ["foo.py"])
        assert "a3f9c821" in refs
        assert "b7d2e104" in refs


# ── scan_to_refs ──────────────────────────────────────────────────────────────

class TestScanToRefs:
    def test_simple(self, tmp_path):
        (tmp_path / "foo.py").write_text("# see to_ref:a3f9c821\n")
        result = scan_to_refs(tmp_path, ["foo.py"])
        assert "a3f9c821" in result
        assert result["a3f9c821"][0] == {"file": "foo.py", "line": 1}

    def test_named(self, tmp_path):
        (tmp_path / "foo.py").write_text("# to_ref:auth-guard:a3f9c821\n")
        result = scan_to_refs(tmp_path, ["foo.py"])
        assert result["a3f9c821"][0]["name"] == "auth-guard"

    def test_commit_pinned(self, tmp_path):
        (tmp_path / "foo.py").write_text("# to_ref:@abc1234:a3f9c821\n")
        result = scan_to_refs(tmp_path, ["foo.py"])
        assert result["a3f9c821"][0]["commit"] == "abc1234"

    def test_commit_pinned_named(self, tmp_path):
        (tmp_path / "foo.py").write_text("# to_ref:@abc1234:rate-limiter:a3f9c821\n")
        result = scan_to_refs(tmp_path, ["foo.py"])
        occ = result["a3f9c821"][0]
        assert occ["commit"] == "abc1234"
        assert occ["name"] == "rate-limiter"

    def test_multiple_occurrences(self, tmp_path):
        (tmp_path / "foo.py").write_text(
            "# to_ref:a3f9c821\n"
            "# also to_ref:a3f9c821\n"
        )
        result = scan_to_refs(tmp_path, ["foo.py"])
        assert len(result["a3f9c821"]) == 2

    def test_not_matched_without_word_boundary(self, tmp_path):
        (tmp_path / "foo.py").write_text("# xto_ref:a3f9c821\n")
        result = scan_to_refs(tmp_path, ["foo.py"])
        assert result == {}

    def test_skips_coderef_file(self, tmp_path):
        (tmp_path / ".coderef").write_text("a3f9c821 foo.py:1\n")
        result = scan_to_refs(tmp_path, [".coderef"])
        assert result == {}
