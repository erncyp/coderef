"""
Entry point for ``pip install .`` and pre-commit framework integration.

Loads cli/coderef (which has no .py extension) by path and delegates to
its main() function, so the package installs a ``coderef`` console script
without renaming or copying any existing files.
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


def main() -> None:
    src  = Path(__file__).resolve().parent / "cli" / "coderef"
    spec = spec_from_file_location("coderef_cli", src)
    mod  = module_from_spec(spec)          # type: ignore[arg-type]
    spec.loader.exec_module(mod)           # type: ignore[union-attr]
    mod.main()


if __name__ == "__main__":
    main()
