"""Manual cleanup CLI shim.

Run with:

    python -m app.cleanup --once

Exits 0 on success. The single `--once` flag exists so that future
expansions (e.g. `--dry-run`, `--json`) have a stable flag to add
without breaking callers.

Why a top-level module and not buried under `app.worker`:
- The user-facing command line should be discoverable and short.
- `python -m app.cleanup` is what the docker-compose example shows.
"""
from __future__ import annotations

import argparse
import json
import sys

from app.core.logging import configure_logging
from app.services.cleanup import cleanup_once


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.cleanup",
        description="Run one cleanup pass and exit (manual mode).",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        default=True,
        help="Run a single cleanup pass and exit (default; only mode for now).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the CleanupReport as a single JSON line on stdout.",
    )
    args = parser.parse_args()
    configure_logging()

    report = cleanup_once()
    if args.json:
        # The structured log already covers the operational view; this
        # is for scripts that want the raw numbers (e.g. CI reporting
        # cleanup volume over time).
        sys.stdout.write(json.dumps(report.to_dict()) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
