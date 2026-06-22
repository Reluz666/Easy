"""End-to-end smoke for /api/jobs/ocr.

Reports duration, sizes, percent changes, status, and verifies the output
PDF opens cleanly and contains a searchable text layer.

Run inside the api container:

    docker exec easy-api-1 python /tmp/smoke_ocr.py /path/to/scan.pdf

The script reads the file path from argv[1], so it works against any
scanned PDF the user drops in. It exits non-zero if the OCR fails or the
output is missing/unreadable, so CI/scripts can use the exit code as a
go/no-go.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = os.environ.get("API_BASE", "http://localhost:8000")
OCR_ENDPOINT = f"{API_BASE}/api/jobs/ocr"
STATUS_ENDPOINT_TPL = f"{API_BASE}/api/jobs/{{job_id}}"
POLL_INTERVAL_S = 5.0
POLL_TIMEOUT_S = 20 * 60  # 20 minutes — generous for the 17 MB probe


def post_ocr(path: Path, lang: str = "spa+eng") -> str:
    boundary = "----smoke-ocr-boundary"
    file_bytes = path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode() + file_bytes + (
        f"\r\n--{boundary}\r\n"
        f'Content-Disposition: form-data; name="lang"\r\n\r\n'
        f"{lang}\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        OCR_ENDPOINT,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 202:
            raise SystemExit(f"POST /api/jobs/ocr returned {resp.status}: {resp.read()[:200]!r}")
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


def verify_output(output_path: Path, input_bytes: int) -> dict:
    """Run PyMuPDF on the output to confirm it opens, count pages, and
    extract a few words from the text layer to prove OCR worked."""
    import fitz  # PyMuPDF
    if not output_path.is_file():
        return {"opens": False, "reason": f"output file missing: {output_path}"}
    output_bytes = output_path.stat().st_size
    try:
        doc = fitz.open(str(output_path))
    except Exception as exc:
        return {"opens": False, "reason": f"fitz.open failed: {exc}"}

    try:
        page_count = doc.page_count
        sample_words = []
        # Walk up to 5 pages or until we find some text.
        for i in range(min(page_count, 5)):
            text = doc[i].get_text("text").strip()
            if text:
                sample_words.append({"page": i + 1, "chars": len(text), "preview": text[:120]})
        # Aggregate text-layer coverage across the whole document.
        total_chars = 0
        pages_with_text = 0
        for i in range(page_count):
            t = doc[i].get_text("text")
            if t.strip():
                pages_with_text += 1
                total_chars += len(t)
    finally:
        doc.close()

    return {
        "opens": True,
        "pages": page_count,
        "output_bytes": output_bytes,
        "size_change_pct": round(((output_bytes - input_bytes) / input_bytes) * 100, 2)
        if input_bytes else 0,
        "reduction_pct": round(((input_bytes - output_bytes) / input_bytes) * 100, 2)
        if input_bytes else 0,
        "text_layer_chars": total_chars,
        "pages_with_text": pages_with_text,
        "text_layer_pct": round((pages_with_text / page_count) * 100, 1) if page_count else 0,
        "sample": sample_words,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: smoke_ocr.py <path-to-pdf> [lang]", file=sys.stderr)
        return 2
    pdf = Path(sys.argv[1]).resolve()
    lang = sys.argv[2] if len(sys.argv) > 2 else "spa+eng"
    if not pdf.is_file():
        print(f"input file not found: {pdf}", file=sys.stderr)
        return 2
    input_bytes = pdf.stat().st_size
    print(f"[smoke] input={pdf} bytes={input_bytes} lang={lang}")

    job_id = post_ocr(pdf, lang=lang)
    info, wall_seconds = wait_terminal(job_id)
    print(f"[smoke] terminal state after {wall_seconds:.1f}s wall time")
    print(f"[smoke] job info: {json.dumps(info, indent=2, default=str)}")

    if info["status"] != "done":
        print(f"[smoke] FAIL: status={info['status']} error_code={info.get('error_code')} "
              f"error_message={info.get('error_message')}")
        return 1

    output_path_setting = info.get("output_path")
    if not output_path_setting:
        print("[smoke] FAIL: done but output_path is null")
        return 1
    output_path = Path(output_path_setting)
    report = verify_output(output_path, input_bytes)
    print(f"[smoke] output verification: {json.dumps(report, indent=2, ensure_ascii=False)}")

    if not report.get("opens"):
        print(f"[smoke] FAIL: output PDF does not open: {report.get('reason')}")
        return 1
    if report.get("text_layer_pct", 0) < 10:
        # Less than 10% of pages with detectable text => OCR didn't really run.
        print(f"[smoke] FAIL: text layer covers only "
              f"{report.get('text_layer_pct')}% of pages — OCR did not run as expected")
        return 1

    print("[smoke] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
