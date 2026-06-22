"""End-to-end smoke for POST /api/jobs/pages.

Builds two tagged PDFs (main + extra), POSTs a single request with all
four ops applied in priority order (delete → insert → rotate → reorder),
polls the status, then verifies the output with pikepdf:

* Page count matches the expected post-op total
* Content tags are in the expected order (proves delete/insert/reorder)
* /Rotate values match the expected cumulative rotation
* Inserted pages came from the extra PDF (tag prefix matches)
* Deleted pages are absent (tag prefix absent)

Run inside the api container:

    docker exec easy-api-1 python /tmp/smoke_pages.py

The script exits non-zero on any failure so it can be wired into CI as
a go/no-go probe.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pikepdf

API_BASE = os.environ.get("API_BASE", "http://localhost:8000")
PAGES_ENDPOINT = f"{API_BASE}/api/jobs/pages"
STATUS_ENDPOINT_TPL = f"{API_BASE}/api/jobs/{{job_id}}"
POLL_INTERVAL_S = 1.0
POLL_TIMEOUT_S = 5 * 60  # page edits are sub-second; generous


def build_tagged_pdf(path: Path, prefix: str, count: int) -> None:
    """Write a real PDF with `count` pages. Each page's /Contents stream
    contains a short tag `prefix_<n>` so the test can assert identity."""
    pdf = pikepdf.Pdf.new()
    for n in range(1, count + 1):
        # Stream body: just the tag text, drawn at the origin.
        content = pikepdf.Stream(
            pdf,
            f"BT /F1 18 Tf 72 720 Td ({prefix}_{n}) Tj ET".encode(),
        )
        page = pikepdf.Dictionary(
            Type=pikepdf.Name.Page,
            MediaBox=[0, 0, 612, 792],
            Contents=content,
        )
        # Set a Rotate=0 baseline so tests can assert the field changed.
        page_obj = pikepdf.Page(page)
        page_obj["/Rotate"] = 0
        pdf.pages.append(page_obj)
    pdf.save(str(path))


def post_pages(
    *,
    main_path: Path,
    extra_path: Path | None,
    ops: list[dict],
) -> str:
    boundary = "----smoke-pages-boundary"
    parts: list[bytes] = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{main_path.name}"\r\n'.encode(),
        b"Content-Type: application/pdf\r\n\r\n",
        main_path.read_bytes(),
        f"\r\n--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="ops"\r\n\r\n',
        json.dumps(ops).encode(),
    ]
    if extra_path is not None:
        parts += [
            f"\r\n--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="extra_file"; filename="{extra_path.name}"\r\n'.encode(),
            b"Content-Type: application/pdf\r\n\r\n",
            extra_path.read_bytes(),
        ]
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)

    req = urllib.request.Request(
        PAGES_ENDPOINT,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 202:
            raise SystemExit(f"POST /api/jobs/pages returned {resp.status}: {resp.read()[:200]!r}")
        payload = json.loads(resp.read())
    job_id = payload["jobId"]
    print(f"[smoke] POST ok -> jobId={job_id} status={payload['status']}")
    return job_id


def get_status(job_id: str) -> dict:
    with urllib.request.urlopen(STATUS_ENDPOINT_TPL.format(job_id=job_id), timeout=10) as resp:
        return json.loads(resp.read())


def wait_terminal(job_id: str) -> tuple[dict, float]:
    started = time.perf_counter()
    while True:
        info = get_status(job_id)
        elapsed = time.perf_counter() - started
        if info["status"] in ("done", "failed"):
            return info, elapsed
        if elapsed > POLL_TIMEOUT_S:
            raise SystemExit(f"timed out after {elapsed:.0f}s waiting for terminal state")
        time.sleep(POLL_INTERVAL_S)


def _extract_text(pdf: pikepdf.Pdf) -> list[str]:
    """Pull a single tag string out of each page's /Contents stream. Falls
    back to an empty string for pages without parseable content."""
    out: list[str] = []
    for page in pdf.pages:
        contents = page.get("/Contents")
        if contents is None:
            out.append("")
            continue
        try:
            # /Contents is either an indirect stream object or an array of
            # such objects. Either way, we can call read_bytes() on each.
            if isinstance(contents, pikepdf.Array):
                data = b"".join(
                    obj.read_bytes() if hasattr(obj, "read_bytes") else b""
                    for obj in contents
                )
            elif hasattr(contents, "read_bytes"):
                data = contents.read_bytes()
            else:
                data = b""
        except Exception:
            data = b""
        text = data.decode("latin1", errors="ignore")
        # Tag format is "(<tag>)" inside a Tj — match anything in parens.
        start = text.find("(")
        end = text.find(")", start + 1) if start >= 0 else -1
        out.append(text[start + 1:end] if start >= 0 and end > start else "")
    return out


def verify(
    output_path: Path,
    *,
    expected_count: int,
    expected_tags: list[str],
    expected_rotations: list[int],
) -> dict:
    if not output_path.is_file():
        return {"opens": False, "reason": f"output file missing: {output_path}"}
    try:
        pdf = pikepdf.open(str(output_path))
    except Exception as exc:
        return {"opens": False, "reason": f"pikepdf.open failed: {exc}"}
    try:
        page_count = len(pdf.pages)
        tags = _extract_text(pdf)
        rotations = [int(page.get("/Rotate", 0)) for page in pdf.pages]
    finally:
        pdf.close()
    return {
        "opens": True,
        "page_count": page_count,
        "expected_count": expected_count,
        "tags": tags,
        "expected_tags": expected_tags,
        "rotations": rotations,
        "expected_rotations": expected_rotations,
    }


def main() -> int:
    work = Path("/tmp/smoke_pages")
    work.mkdir(exist_ok=True)
    main_pdf = work / "main.pdf"
    extra_pdf = work / "extra.pdf"

    # Main: 5 pages tagged MAIN_1 .. MAIN_5
    build_tagged_pdf(main_pdf, prefix="MAIN", count=5)
    # Extra: 3 pages tagged EXTRA_1 .. EXTRA_3
    build_tagged_pdf(extra_pdf, prefix="EXTRA", count=3)

    # Combined scenario exercising every op:
    #   1) delete pages 4 and 5 of main     -> MAIN_1..3 remain
    #   2) insert EXTRA_2 after page 1      -> MAIN_1, EXTRA_2, MAIN_2..3
    #   3) rotate resulting page 3 by 180   -> rotate the third page (MAIN_2)
    #   4) reorder to [4, 1, 2, 3]          -> the 4th tag moves to position 1
    #
    # After step 1: state = [MAIN_1, MAIN_2, MAIN_3]  (3 pages)
    # After step 2: state = [MAIN_1, EXTRA_2, MAIN_2, MAIN_3]  (4 pages)
    # After step 3: state[3rd page] (0-indexed 2, i.e. MAIN_2) gets /Rotate=180
    # After step 4: reorder [4, 1, 2, 3] -> [MAIN_3, MAIN_1, EXTRA_2, MAIN_2]
    #             page 4 was MAIN_3 (the previously un-rotated third page)
    #             page 3 was MAIN_2 (the rotated page); its rotation sticks.
    #
    # Note that op page numbers reference the *current* state at that point.
    ops = [
        {"op": "delete", "pages": [4, 5]},
        {"op": "insert", "after_page": 1, "from_pdf": "extra", "pages": [2]},
        {"op": "rotate", "pages": [3], "degrees": 180},
        {"op": "reorder", "order": [4, 1, 2, 3]},
    ]

    print(f"[smoke] main={main_pdf} ({main_pdf.stat().st_size} B)")
    print(f"[smoke] extra={extra_pdf} ({extra_pdf.stat().st_size} B)")
    print(f"[smoke] ops={ops}")

    job_id = post_pages(main_path=main_pdf, extra_path=extra_pdf, ops=ops)
    info, wall = wait_terminal(job_id)
    print(f"[smoke] terminal state after {wall:.2f}s wall time")
    print(f"[smoke] job: status={info['status']} error={info.get('error_code')}")
    if info["status"] != "done":
        print(f"[smoke] FAIL: status={info['status']} message={info.get('error_message')}")
        return 1

    output_path = Path(info["output_path"])
    expected_tags = ["MAIN_3", "MAIN_1", "EXTRA_2", "MAIN_2"]
    expected_rotations = [0, 0, 0, 180]
    report = verify(
        output_path,
        expected_count=4,
        expected_tags=expected_tags,
        expected_rotations=expected_rotations,
    )
    print(f"[smoke] output verification: {json.dumps(report, indent=2, ensure_ascii=False)}")

    if not report.get("opens"):
        print(f"[smoke] FAIL: output does not open: {report.get('reason')}")
        return 1
    if report.get("page_count") != 4:
        print(f"[smoke] FAIL: expected 4 pages, got {report.get('page_count')}")
        return 1
    if report.get("tags") != expected_tags:
        print(f"[smoke] FAIL: tags mismatch — expected {expected_tags} got {report.get('tags')}")
        return 1
    if report.get("rotations") != expected_rotations:
        print(f"[smoke] FAIL: rotations mismatch — expected {expected_rotations} got {report.get('rotations')}")
        return 1

    print("[smoke] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
