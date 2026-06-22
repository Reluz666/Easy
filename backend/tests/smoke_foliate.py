"""End-to-end smoke for POST /api/jobs/foliate.

Builds a real multi-page PDF, POSTs it to the foliate endpoint, polls
the status, verifies the output with PyMuPDF: page count preserved,
folio text rendered on the right pages, no text on out-of-range pages.

Run inside the api container:

    docker exec easy-api-1 python /tmp/smoke_foliate.py
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import fitz  # PyMuPDF

API_BASE = os.environ.get("API_BASE", "http://localhost:8000")
FOLIATE_ENDPOINT = f"{API_BASE}/api/jobs/foliate"
STATUS_ENDPOINT_TPL = f"{API_BASE}/api/jobs/{{job_id}}"
POLL_INTERVAL_S = 1.0
POLL_TIMEOUT_S = 5 * 60  # foliate is sub-second; generous


def build_test_pdf(path: Path, page_count: int = 5) -> None:
    doc = fitz.open()
    for _ in range(page_count):
        doc.insert_page(-1, width=612, height=792)
    doc.save(str(path))
    doc.close()


def post_foliate(path: Path, *, initial_number: int, prefix: str, position: str,
                 font_size: int, range_mode: str, from_page: int | None = None,
                 to_page: int | None = None) -> str:
    boundary = "----smoke-foliate-boundary"
    file_bytes = path.read_bytes()
    parts: list[bytes] = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
        b"Content-Type: application/pdf\r\n\r\n",
        file_bytes,
        f"\r\n--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="initial_number"\r\n\r\n{initial_number}\r\n--{boundary}\r\n'.encode(),
        f'Content-Disposition: form-data; name="prefix"\r\n\r\n{prefix}\r\n--{boundary}\r\n'.encode(),
        f'Content-Disposition: form-data; name="position"\r\n\r\n{position}\r\n--{boundary}\r\n'.encode(),
        f'Content-Disposition: form-data; name="font_size"\r\n\r\n{font_size}\r\n--{boundary}\r\n'.encode(),
        f'Content-Disposition: form-data; name="range_mode"\r\n\r\n{range_mode}\r\n'.encode(),
    ]
    if from_page is not None:
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="from_page"\r\n\r\n{from_page}\r\n'.encode())
    if to_page is not None:
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="to_page"\r\n\r\n{to_page}\r\n'.encode())
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    req = urllib.request.Request(
        FOLIATE_ENDPOINT,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 202:
            raise SystemExit(f"POST /api/jobs/foliate returned {resp.status}: {resp.read()[:200]!r}")
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


def verify_output(output_path: Path, *, expected_pages: int, expected_prefix: str,
                  in_range_pages: list[int], out_of_range_pages: list[int],
                  initial_number: int) -> dict:
    """Open the output with PyMuPDF and check folio presence per page."""
    if not output_path.is_file():
        return {"opens": False, "reason": f"output file missing: {output_path}"}
    try:
        doc = fitz.open(str(output_path))
    except Exception as exc:
        return {"opens": False, "reason": f"fitz.open failed: {exc}"}

    try:
        page_count = doc.page_count
        # Pages inside the range should contain folio text matching the
        # expected (prefix + number) for that page's position in the range.
        in_range_hits: dict[int, list[str]] = {}
        out_of_range_hits: dict[int, list[str]] = {}
        first_in_range_index = in_range_pages[0] if in_range_pages else None
        for p in in_range_pages:
            text = doc[p - 1].get_text("text")
            folio_number = initial_number + (p - first_in_range_index)
            expected = f"{expected_prefix}{folio_number}"
            in_range_hits[p] = [tok for tok in (expected, str(folio_number)) if tok and tok in text]
        for p in out_of_range_pages:
            text = doc[p - 1].get_text("text")
            # Out-of-range pages shouldn't contain the numeric folio value.
            any_in_range_number = any(
                str(initial_number + (q - first_in_range_index)) in text
                for q in in_range_pages
            )
            out_of_range_hits[p] = {"any_in_range_number": any_in_range_number}
    finally:
        doc.close()

    return {
        "opens": True,
        "page_count": page_count,
        "expected_pages": expected_pages,
        "in_range_hits": in_range_hits,
        "out_of_range_hits": out_of_range_hits,
    }


def run_scenario(label: str, *, initial_number: int, prefix: str, position: str,
                 font_size: int, range_mode: str, from_page: int | None,
                 to_page: int | None, in_range_pages: list[int],
                 out_of_range_pages: list[int]) -> int:
    tmp = Path("/tmp/smoke_foliate_input.pdf")
    build_test_pdf(tmp, page_count=5)
    input_bytes = tmp.stat().st_size
    print(f"\n[smoke] === scenario: {label} ===")
    print(f"[smoke] input_bytes={input_bytes}")

    job_id = post_foliate(
        tmp,
        initial_number=initial_number,
        prefix=prefix,
        position=position,
        font_size=font_size,
        range_mode=range_mode,
        from_page=from_page,
        to_page=to_page,
    )
    info, wall = wait_terminal(job_id)
    print(f"[smoke] terminal state after {wall:.2f}s")
    print(f"[smoke] job: status={info['status']} error_code={info.get('error_code')}")
    if info["status"] != "done":
        print(f"[smoke] FAIL: status={info['status']} error={info.get('error_message')}")
        return 1

    output_path = Path(info["output_path"])
    report = verify_output(
        output_path,
        expected_pages=5,
        expected_prefix=prefix,
        in_range_pages=in_range_pages,
        out_of_range_pages=out_of_range_pages,
        initial_number=initial_number,
    )
    print(f"[smoke] output: {json.dumps(report, indent=2, ensure_ascii=False)}")

    if not report.get("opens"):
        print(f"[smoke] FAIL: output does not open: {report.get('reason')}")
        return 1
    if report.get("page_count") != 5:
        print(f"[smoke] FAIL: expected 5 pages, got {report['page_count']}")
        return 1
    for p, hits in report["in_range_hits"].items():
        if not hits:
            print(f"[smoke] FAIL: page {p} (in range) missing folio text")
            return 1
    for p, info_oor in report["out_of_range_hits"].items():
        if info_oor.get("any_in_range_number"):
            print(f"[smoke] FAIL: page {p} (out of range) contains folio text")
            return 1
    return 0


def main() -> int:
    scenarios: list[dict] = [
        dict(
            label="All pages, prefix 'Folio ', bottom-right",
            initial_number=1, prefix="Folio ", position="bottom-right",
            font_size=14, range_mode="all", from_page=None, to_page=None,
            in_range_pages=[1, 2, 3, 4, 5], out_of_range_pages=[],
        ),
        dict(
            label="From-to 2..4, initial 100, top-center",
            initial_number=100, prefix="", position="top-center",
            font_size=20, range_mode="from-to", from_page=2, to_page=4,
            in_range_pages=[2, 3, 4], out_of_range_pages=[1, 5],
        ),
        dict(
            label="From-to 1..1, initial 50, top-left",
            initial_number=50, prefix="Pág. ", position="top-left",
            font_size=12, range_mode="from-to", from_page=1, to_page=1,
            in_range_pages=[1], out_of_range_pages=[2, 3, 4, 5],
        ),
    ]
    failures = 0
    for s in scenarios:
        rc = run_scenario(**s)
        failures += rc
    if failures:
        print(f"\n[smoke] {failures} scenario(s) FAILED")
        return 1
    print("\n[smoke] all scenarios OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
