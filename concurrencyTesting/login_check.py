#!/usr/bin/env python3
"""Send repeated login requests and summarize reliability and latency."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass


DEFAULT_URL = "https://presenton.parajulisudip.com.np/api/v1/auth/jwt/login"


@dataclass(frozen=True)
class Result:
    request_number: int
    status: int | None
    elapsed_seconds: float
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call a form-based login endpoint repeatedly."
    )
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--username", default="sudip@presenton.ai")
    parser.add_argument("--password", default="75f2f0a39d3b503fd8e0c180d18b3cd6")
    parser.add_argument("--auth-token", default=os.getenv("AUTH_TOKEN"))
    parser.add_argument("--requests", type=int, default=10, help="Total requests")
    parser.add_argument("--concurrency", type=int, default=1, help="Parallel workers")
    parser.add_argument("--timeout", type=float, default=30.0, help="Timeout per request")
    args = parser.parse_args()

    if not args.username or not args.password:
        parser.error(
            "provide --username and --password, or set LOGIN_USERNAME and LOGIN_PASSWORD"
        )
    if args.requests < 1:
        parser.error("--requests must be at least 1")
    if args.concurrency < 1:
        parser.error("--concurrency must be at least 1")
    if args.timeout <= 0:
        parser.error("--timeout must be greater than 0")
    return args


def login(request_number: int, args: argparse.Namespace) -> Result:
    form_data = urllib.parse.urlencode(
        {
            "username": args.username,
            "password": args.password,
            "grant_type": "password",
            "scope": "",
            "client_id": "string",
            "client_secret": "string",
        }
    ).encode()
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    if args.auth_token:
        headers["Cookie"] = f"auth_token={args.auth_token}"

    request = urllib.request.Request(args.url, data=form_data, headers=headers, method="POST")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            response.read()
            return Result(request_number, response.status, time.perf_counter() - started)
    except urllib.error.HTTPError as exc:
        # HTTP failures are valid responses and are grouped by their status code.
        exc.read()
        return Result(request_number, exc.code, time.perf_counter() - started)
    except Exception as exc:  # Includes timeouts, DNS, TLS, and connection errors.
        return Result(
            request_number,
            None,
            time.perf_counter() - started,
            f"{type(exc).__name__}: {exc}",
        )


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def main() -> int:
    args = parse_args()
    worker_count = min(args.concurrency, args.requests)
    results: list[Result] = []
    wall_started = time.perf_counter()

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(login, number, args) for number in range(1, args.requests + 1)]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            status = result.status if result.status is not None else "ERROR"
            detail = f" - {result.error}" if result.error else ""
            print(
                f"[{result.request_number:>4}/{args.requests}] "
                f"status={status} latency={result.elapsed_seconds * 1000:.1f} ms{detail}"
            )

    wall_seconds = time.perf_counter() - wall_started
    latencies = [result.elapsed_seconds * 1000 for result in results]
    status_counts = Counter(
        str(result.status) if result.status is not None else "ERROR" for result in results
    )
    successful = sum(result.status is not None and 200 <= result.status < 300 for result in results)

    print("\nSummary")
    print(f"  Requests:     {len(results)}")
    print(f"  Successful:   {successful}")
    print(f"  Failed:       {len(results) - successful}")
    print(f"  Statuses:     {json.dumps(dict(sorted(status_counts.items())))}")
    print(f"  Wall time:    {wall_seconds:.3f} s")
    print(f"  Throughput:   {len(results) / wall_seconds:.2f} requests/s")
    print(f"  Mean latency: {statistics.fmean(latencies):.1f} ms")
    print(f"  P50 latency:  {percentile(latencies, 0.50):.1f} ms")
    print(f"  P95 latency:  {percentile(latencies, 0.95):.1f} ms")
    print(f"  Max latency:  {max(latencies):.1f} ms")
    return 0 if successful == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
