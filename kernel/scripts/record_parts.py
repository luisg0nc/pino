"""Record jlcsearch answers into test fixtures. Run by hand, with network; tests never run it.

    uv run --directory kernel python scripts/record_parts.py tests/fixtures/parts/jlcsearch <url>...

Only the fields pino reads are kept.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pino_kernel.parts.transport import http_transport, recorded_name

FIELDS = ("lcsc", "mfr", "package", "description", "is_basic", "is_preferred", "stock", "price", "stock_checked_at")
ERROR_FIELDS = ("error", "error_code", "message")
HEADERS = ("retry-after",)


def record(url: str, folder: Path) -> Path:
    response = http_transport(url, 30.0)
    body = json.loads(response.body)
    if "components" in body:
        body = {"components": [{k: row[k] for k in FIELDS if k in row} for row in body["components"]]}
    else:
        body = {k: body[k] for k in ERROR_FIELDS if k in body}
    out = {"url": url, "status": response.status, "body": body}
    kept = {k: v for k, v in response.headers.items() if k in HEADERS}
    if kept:
        out["headers"] = kept
    path = folder / recorded_name(url)
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    folder = Path(argv[0])
    folder.mkdir(parents=True, exist_ok=True)
    for url in argv[1:]:
        print(record(url, folder).name, url)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
