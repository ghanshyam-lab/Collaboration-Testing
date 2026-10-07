#!/usr/bin/env python3
"""Send concurrent presentation-share requests and summarize the responses."""

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


DEFAULT_PRESENTATION_ID = "baf9edca-1150-4217-8bac-1fd9d223f5f5"
DEFAULT_BASE_URL = "https://enterprise.parajulisudip.com.np"


@dataclass(frozen=True)
class Result:
    request_number: int
    status: int | None
    elapsed_seconds: float
    body: str
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Race simultaneous share requests against one presentation."
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--presentation-id", default=DEFAULT_PRESENTATION_ID)
    parser.add_argument("--email", default="concurrencyUser2@yopmail.com")
    parser.add_argument("--permission", choices=("view", "edit"), default="edit")
    parser.add_argument("--auth-token", default="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5MTM0Y2E0My1hNTdhLTQxMzAtOTM5Mi05YTk4ZTI1NzBlNmEiLCJhdWQiOlsiZmFzdGFwaS11c2VyczphdXRoIl0sInNpZCI6IjRmZjgyOGNhLTEzN2ItNGJmMy05YjkxLWE5YTE1MjM3ZDEzMSIsImp0aSI6IjRmZjgyOGNhLTEzN2ItNGJmMy05YjkxLWE5YTE1MjM3ZDEzMSIsImV4cCI6MTc5MjkwNjUzNn0.v2J3NZAdY_Snx5cm1mo7or7zaUilEx2-lLhLiodjTLo")
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


def send_share(
    request_number: int, args: argparse.Namespace, start_gate: threading.Event
) -> Result:
    url = (
        f"{args.base_url.rstrip('/')}/api/v1/presentations/"
        f"{args.presentation_id}/shares"
    )
    payload = json.dumps(
        {"email": args.email, "permission": args.permission}
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "Content-Type": "application/json",
            "Cookie": f"auth_token={args.auth_token}",
            "Origin": args.base_url.rstrip("/"),
            "Pragma": "no-cache",
            "Referer": (
                f"{args.base_url.rstrip('/')}/presentation?id="
                f"{args.presentation_id}"
            ),
            "User-Agent": "presentation-share-concurrency-test/1.0",
        },
        method="POST",
    )

    # All workers are created before this gate opens, producing one request burst.
    start_gate.wait()
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return Result(
                request_number, response.status, time.perf_counter() - started, body
            )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return Result(request_number, exc.code, time.perf_counter() - started, body)
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
            executor.submit(send_share, number, args, start_gate)
            for number in range(1, args.requests + 1)
        ]
        start_gate.set()
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            status = result.status if result.status is not None else "ERROR"
            detail = result.error or result.body.replace("\n", " ")
            print(
                f"[{result.request_number:>2}/{args.requests}] "
                f"status={status} latency={result.elapsed_seconds * 1000:.1f} ms "
                f"body={detail[:500]!r}"
            )

    wall_seconds = time.perf_counter() - wall_started
    latencies = [result.elapsed_seconds * 1000 for result in results]
    statuses = Counter(
        str(result.status) if result.status is not None else "ERROR"
        for result in results
    )
    successes = sum(
        result.status is not None and 200 <= result.status < 300 for result in results
    )

    print("\nSummary")
    print(f"  Requests:      {len(results)}")
    print(f"  2xx responses: {successes}")
    print(f"  Statuses:      {json.dumps(dict(sorted(statuses.items())))}")
    print(f"  Wall time:     {wall_seconds:.3f} s")
    print(f"  Throughput:    {len(results) / wall_seconds:.2f} requests/s")
    print(f"  Mean latency:  {statistics.fmean(latencies):.1f} ms")
    print(f"  P50 latency:   {percentile(latencies, 0.50):.1f} ms")
    print(f"  P95 latency:   {percentile(latencies, 0.95):.1f} ms")
    print(f"  Max latency:   {max(latencies):.1f} ms")

    # A correctly deduplicated race should create at most one share record.
    return 0 if successes <= 1 else 1


if __name__ == "__main__":
    raise SystemExit(main())
