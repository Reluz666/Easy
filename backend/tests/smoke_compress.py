"""Smoke test: try alta preset on the real 17MB PDF (faster than media).

Uses urllib only — httpx is a test-time dep, not always present in the api image.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path
from urllib.error import HTTPError

API = "http://localhost:8000"
PDF = Path(sys.argv[3] if len(sys.argv) > 3 else "/tmp/cv.pdf")


def _http_get_json(url: str, timeout: int = 10) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _http_post_multipart(url: str, file_path: Path, preset: str, timeout: int = 60) -> int:
    boundary = "----smokeboundary12345"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="level"\r\n\r\n'
        f"{preset}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode() + file_path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8")
    except HTTPError as exc:
        return exc.code, exc.read().decode("utf-8")


def _http_get_bytes(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def main(preset: str, max_poll: int) -> int:
    print(f"== Uploading {preset=}, max_poll={max_poll}s ==")
    status, body = _http_post_multipart(
        f"{API}/api/jobs/compress", PDF, preset, timeout=120
    )
    print(f"  -> {status} {body[:200]}")
    if status != 202:
        return 1
    job_id = json.loads(body)["jobId"]

    final = None
    for i in range(max_poll):
        time.sleep(1)
        s = _http_get_json(f"{API}/api/jobs/{job_id}")
        print(
            f"  poll {i:3}: status={s['status']:10} progress={s['progress']:3} "
            f"in={s['input_bytes']:>9} out={str(s.get('output_bytes')):>9} "
            f"reduction={str(s.get('reduction_pct')):>6}%"
        )
        if s["status"] in ("done", "failed"):
            final = s
            break
    if final is None or final["status"] != "done":
        print(f"NOT_DONE: {final.get('error_code') if final else 'timeout'} "
              f"{final.get('error_message') if final else ''}")
        return 1

    content = _http_get_bytes(f"{API}/api/jobs/{job_id}/download", timeout=120)
    out = Path(f"/tmp/cv-{preset}.pdf")
    out.write_bytes(content)
    print(f"  downloaded {len(content)} bytes -> {out}")
    return 0 if content.startswith(b"%PDF-") else 1


if __name__ == "__main__":
    preset = sys.argv[1] if len(sys.argv) > 1 else "alta"
    max_poll = int(sys.argv[2]) if len(sys.argv) > 2 else 320
    sys.exit(main(preset, max_poll))