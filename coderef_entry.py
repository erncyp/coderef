"""Entry point shim — kept for backwards compatibility with any pinned pre-commit configs."""
from coderef_core import main  # noqa: F401

if __name__ == "__main__":
    main()
