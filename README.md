# Presenton collaboration stress test

This Playwright suite opens **Nepal and its Historical Achievements** concurrently as the five shared users. By default it generates read-only collaboration traffic by navigating slides. An opt-in mutation phase can also exercise shape creation, selected-element movement, deletion, and an AI-prompted element addition while all collaborators are active.

## Project structure

The tests use the Page Object Model so selectors and UI workflows stay separate
from test scenarios:

```text
tests/
├── pages/
│   ├── login.page.ts
│   ├── presentations.page.ts
│   └── presentation-editor.page.ts
├── support/
│   ├── stress-metrics.ts
│   └── stress-report.ts
└── collaboration.stress.spec.ts
```

Page objects contain browser interactions, support modules calculate and render
performance results, and the spec describes only the user scenarios and stress
orchestration.

## Configure

```bash
cp .env.example .env
```

Set `OWNER_PASSWORD` and `COLLABORATOR_PASSWORD` in `.env`. Passwords and generated reports are gitignored.

## Run

```bash
npm install
npx playwright install chromium
npm run test:smoke
npm run test:stress
npm run test:performance
```

## Performance test matrix

`npm run test:performance` executes all nine combinations below in sequence. Each
virtual user gets an isolated browser context and a distinct test account.

| Workload | 1 user | 5 users | 10 users | Traffic pattern |
| --- | ---: | ---: | ---: | --- |
| Load | Yes | Yes | Yes | Steady navigation at `LOAD_INTERVAL_MS` |
| Stress | Yes | Yes | Yes | Three increasingly intense phases |
| Spike | Yes | Yes | Yes | Normal traffic, sudden burst, recovery |

The comparison report includes operation count, throughput (operations/second),
p90/p95/p99 latency, failed-operation rate, browser/network/HTTP 5xx errors, and a
pass/fail result for every matrix cell. JSON and standalone HTML reports are saved
as `stress-results/performance-matrix-*.{json,html}`.

The default scenario duration is 30 seconds per matrix cell. Configure it with
`PERFORMANCE_DURATION_MS`; tune the traffic with `LOAD_INTERVAL_MS`,
`STRESS_INTERVAL_MS`, and `SPIKE_INTERVAL_MS`. A cell passes when its failed
operation rate is below `FAILURE_RATE_TARGET` (default 1%) and it has no runtime
errors. For example, this quick diagnostic run uses five seconds per cell:

```bash
HEADLESS=true PERFORMANCE_DURATION_MS=5000 npm run test:performance
```

## Editing workflow

The editing test covers adding a shape, moving the selected element, deleting it,
and using the editor's AI prompt to add an element. It is opt-in because it writes
to the shared presentation:

```bash
ENABLE_MUTATION_TESTS=true npm run test:editing
```

The manually added shape is deleted during the test. The AI-created element is
intentionally retained so its collaborative persistence can be verified. Override
the instruction with `AI_EDIT_PROMPT`, and use a disposable deck when repeatability
or preservation of the original presentation matters.

The stress test can run the same editing workflow concurrently before its
navigation load. One user asks the editor AI to add an element while the remaining
users each add, move, and delete a temporary shape; every action is included in the
latency and error-rate report. With a single virtual user, those actions run
sequentially instead:

```bash
ENABLE_MUTATION_TESTS=true npm run test:stress
```

This mode intentionally retains the AI-created element. Use a disposable deck for
repeatable stress runs.

Tests run in a visible Chromium window by default. For a headless CI run, use
`HEADLESS=true npm run test:stress`.

Tune load with `VIRTUAL_USERS`, `STRESS_DURATION_MS`, and `ACTION_INTERVAL_MS`. Users above five reuse the supplied accounts in isolated browser contexts; for a clean capacity test, keep one active session per account unless duplicate sessions are an intended workload.

The stress test fails when operation error rate exceeds `ERROR_RATE_TARGET` (default 5%), p95 interaction latency exceeds `P95_TARGET_MS` (default 3000 ms), any HTTP 5xx response occurs, or the browser reports a request/page error. Raw JSON metrics and a standalone visual performance dashboard are written to `stress-results/`; the Playwright HTML report is written to `playwright-report/`. Open the latest `collaboration-*.html` file in a browser to inspect latency, errors, SLO status, and per-operation performance.
