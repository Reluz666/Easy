"""ULID generator for job IDs.

ULIDs are:
- 26 chars, URL-safe, lexically sortable by creation time
- Distinct from UUIDs so we never confuse them in logs/responses
"""
import ulid


def new_job_id() -> str:
    return str(ulid.new())
