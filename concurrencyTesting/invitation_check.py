#!/usr/bin/env python3
"""Send concurrent workspace invitation requests and summarize the responses."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass


DEFAULT_URL = "https://enterprise.parajulisudip.com.np/api/v1/admin/invitations"


@dataclass(frozen=True)
class Result:
    request_number: int
    status: int | None
    elapsed_seconds: float
    body: str
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send simultaneous invitation requests to check concurrency handling."
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--email", default="concurrencyUser@yopmail.com")
    parser.add_argument(
        "--role-id", default="38edff6a-0478-4faa-861c-6696246acc5b"
    )
    parser.add_argument(
        "--workspace-id", default="b4c0bcd3-4a1f-4104-a43e-02e9179c1324"
    )
    parser.add_argument("--expires-in-days", type=int, default=7)
    parser.add_argument("--reason", default="Concurrent invitation test")
    parser.add_argument("--auth-token", default="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5MTM0Y2E0My1hNTdhLTQxMzAtOTM5Mi05YTk4ZTI1NzBlNmEiLCJhdWQiOlsiZmFzdGFwaS11c2VyczphdXRoIl0sInNpZCI6IjNlY2VlNDgyLWFlMDYtNDgzYy1iYTgwLTAyZjUwNWNlNDg1NiIsImp0aSI6IjNlY2VlNDgyLWFlMDYtNDgzYy1iYTgwLTAyZjUwNWNlNDg1NiIsImV4cCI6MTc5MjgyMjM4M30.TNgHLy0kEeK3f0VRgZxskRmJzW-km2Q4xyYoKW1vXSs")
    parser.add_argument("--requests", type=int, default=10, help="Total requests")
    parser.add_argument("--concurrency", type=int, default=10, help="Parallel workers")
    parser.add_argument("--timeout", type=float, default=30.0, help="Timeout per request")
    args = parser.parse_args()

    if not args.auth_token:
        parser.error("provide --auth-token or set AUTH_TOKEN")
    if args.requests < 1:
        parser.error("--requests must be at least 1")
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    if args.timeout <= 0:
        parser.error("--timeout must be greater than 0")
    return args


def send_invitation(
    request_number: int, args: argparse.Namespace, start_gate: threading.Event
) -> Result:
    payload = json.dumps(
        {
            "email": args.email,
            "role_id": args.role_id,
            "workspace_id": args.workspace_id,
            "expires_in_days": args.expires_in_days,
            "reason": args.reason,
        }
    ).encode()
    request = urllib.request.Request(
        args.url,
        data=payload,
        headers={
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Content-Type": "application/json",
            "Cookie": f"auth_token={args.auth_token}",
            "Origin": "https://enterprise.parajulisudip.com.np",
            "Pragma": "no-cache",
            "Referer": "https://enterprise.parajulisudip.com.np/workspace/members",
            "Sec-Ch-Ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Linux"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
            ),
        },
        method="POST",
    )

    start_gate.wait()
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return Result(
                request_number, response.status, time.perf_counter() - started, body[:300]
            )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return Result(request_number, exc.code, time.perf_counter() - started, body[:300])
    except Exception as exc:
        return Result(
            request_number,
            None,
            time.perf_counter() - started,
            "",
            f"{type(exc).__name__}: {exc}",
        )


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def main() -> int:
    args = parse_args()
    worker_count = min(args.concurrency, args.requests)
    start_gate = threading.Event()
    results: list[Result] = []

    wall_started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [
            executor.submit(send_invitation, number, args, start_gate)
            for number in range(1, args.requests + 1)
        ]
        start_gate.set()
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            status = result.status if result.status is not None else "ERROR"
            detail = result.error or result.body.replace("\n", " ")
            print(
                f"[{result.request_number:>4}/{args.requests}] "
                f"status={status} latency={result.elapsed_seconds * 1000:.1f} ms "
                f"body={detail!r}"
            )

    wall_seconds = time.perf_counter() - wall_started
    latencies = [result.elapsed_seconds * 1000 for result in results]
    statuses = Counter(
        str(result.status) if result.status is not None else "ERROR" for result in results
    )
    successes = sum(
        result.status is not None and 200 <= result.status < 300 for result in results
    )

    print("\nSummary")
    print(f"  Requests:     {len(results)}")
    print(f"  2xx responses:{successes:>5}")
    print(f"  Statuses:     {json.dumps(dict(sorted(statuses.items())))}")
    print(f"  Wall time:    {wall_seconds:.3f} s")
    print(f"  Throughput:   {len(results) / wall_seconds:.2f} requests/s")
    print(f"  Mean latency: {statistics.fmean(latencies):.1f} ms")
    print(f"  P50 latency:  {percentile(latencies, 0.50):.1f} ms")
    print(f"  P95 latency:  {percentile(latencies, 0.95):.1f} ms")
    print(f"  Max latency:  {max(latencies):.1f} ms")

    # For a duplicate-invitation race, exactly one creation is usually expected.
    return 0 if successes == 1 else 1


if __name__ == "__main__":
    raise SystemExit(main())
