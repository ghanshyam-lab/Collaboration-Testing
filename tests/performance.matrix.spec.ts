import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { LoginPage } from './pages/login.page';
import { PresentationEditorPage } from './pages/presentation-editor.page';
import { PresentationsPage } from './pages/presentations.page';
import { createStressSummary, measure, percentile, type Sample, type StressSummary } from './support/stress-metrics';

const accounts = [
  'aasamsha@yopmail.com', 'saurav@yopmail.com', 'shiva@yopmail.com', 'sudip@yopmail.com',
  'suraj@yopmail.com', 'performanceuser1@yopmail.com', 'performanceuser2@yopmail.com',
  'performanceuser3@yopmail.com', 'performanceuser4@yopmail.com', 'performanceuser5@yopmail.com',
];
const userLevels = [1, 5, 10];
const presentation = process.env.PRESENTATION_NAME ?? 'Taco Bell';
const title = new RegExp(`^${presentation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const failureRateTarget = Number(process.env.FAILURE_RATE_TARGET ?? 0.01);

type Profile = 'load' | 'stress' | 'spike';
type Session = { user: string; context: BrowserContext; page: Page; editor: PresentationEditorPage };
type Result = StressSummary & { profile: Profile; throughputOpsPerSecond: number; passed: boolean };

test('@performance load, stress, and spike comparison at 1, 5, and 10 users', async ({ browser }, testInfo) => {
  test.setTimeout(Number(process.env.MATRIX_TIMEOUT_MS ?? 30 * 60_000));
  const password = process.env.COLLABORATOR_PASSWORD;
  test.skip(!password, 'Set COLLABORATOR_PASSWORD');
  const results: Result[] = [];

  for (const profile of ['load', 'stress', 'spike'] as Profile[]) {
    for (const users of userLevels) {
      await test.step(`${profile}: ${users} user${users === 1 ? '' : 's'}`, async () => {
        results.push(await runScenario(browser, profile, users, password!));
      });
    }
  }

  await saveMatrixReport(results, testInfo);
  const failures = results.filter(result => !result.passed);
  expect(failures.map(result => ({
    profile: result.profile,
    users: result.virtualUsers,
    failureRate: result.errorRate,
    runtimeErrors: result.runtimeErrors.length,
  })), 'Every scenario must have <1% failed operations and zero runtime errors').toEqual([]);
});

async function runScenario(browser: Browser, profile: Profile, users: number, password: string): Promise<Result> {
  const samples: Sample[] = [];
  const runtimeErrors: StressSummary['runtimeErrors'] = [];
  const started = Date.now();
  const sessions = await Promise.all(Array.from({ length: users }, (_, index) => openSession(browser, accounts[index], password, samples, runtimeErrors)));

  try {
    for (const phase of phasesFor(profile)) {
      await exercise(sessions, samples, phase.durationMs, phase.intervalMs);
    }
  } finally {
    await Promise.all(sessions.map(session => session.context.close()));
  }

  const summary = createStressSummary({ presentation, virtualUsers: users, durationMs: Date.now() - started, samples, runtimeErrors });
  const throughputOpsPerSecond = summary.totals.operations / (summary.durationMs / 1_000);
  return {
    ...summary,
    profile,
    throughputOpsPerSecond,
    passed: summary.errorRate < failureRateTarget && runtimeErrors.length === 0,
  };
}

function phasesFor(profile: Profile) {
  const duration = Number(process.env.PERFORMANCE_DURATION_MS ?? 30_000);
  const normal = Number(process.env.LOAD_INTERVAL_MS ?? 1_000);
  const intense = Number(process.env.STRESS_INTERVAL_MS ?? 150);
  const spike = Number(process.env.SPIKE_INTERVAL_MS ?? 50);
  if (profile === 'load') return [{ durationMs: duration, intervalMs: normal }];
  if (profile === 'stress') return [
    { durationMs: duration / 3, intervalMs: normal },
    { durationMs: duration / 3, intervalMs: Math.max(intense * 2, 100) },
    { durationMs: duration / 3, intervalMs: intense },
  ];
  return [
    { durationMs: duration * 0.25, intervalMs: normal },
    { durationMs: duration * 0.5, intervalMs: spike },
    { durationMs: duration * 0.25, intervalMs: normal },
  ];
}

async function openSession(
  browser: Browser,
  user: string,
  password: string,
  samples: Sample[],
  runtimeErrors: StressSummary['runtimeErrors'],
): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  monitor(page, user, runtimeErrors);
  let editor = new PresentationEditorPage(page, title);
  await measure(samples, user, 'login', () => new LoginPage(page).signIn(user, password));
  await measure(samples, user, 'open-deck', async () => {
    await new PresentationsPage(page).openPresentation(title);
    editor = new PresentationEditorPage(page, title);
    await editor.expectLoaded();
  });
  return { user, context, page, editor };
}

async function exercise(sessions: Session[], samples: Sample[], durationMs: number, intervalMs: number) {
  const deadline = Date.now() + durationMs;
  await Promise.all(sessions.map(async ({ user, page, editor }, index) => {
    let direction: 'ArrowUp' | 'ArrowDown' = index % 2 ? 'ArrowUp' : 'ArrowDown';
    while (Date.now() < deadline) {
      await measure(samples, user, 'navigate-slide', () => editor.navigateSlide(direction));
      direction = direction === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown';
      await page.waitForTimeout(intervalMs);
    }
  }));
}

function monitor(page: Page, user: string, errors: StressSummary['runtimeErrors']) {
  page.on('pageerror', error => errors.push({ user, kind: 'pageerror', message: error.message }));
  page.on('requestfailed', request => {
    const message = request.failure()?.errorText ?? 'unknown error';
    if (message !== 'net::ERR_ABORTED') errors.push({ user, kind: 'requestfailed', message: `${request.method()} ${request.url()} ${message}` });
  });
  page.on('response', response => {
    if (response.status() >= 500) errors.push({ user, kind: 'http5xx', message: `${response.status()} ${response.url()}` });
  });
}

async function saveMatrixReport(results: Result[], testInfo: TestInfo) {
  await mkdir('stress-results', { recursive: true });
  const base = `stress-results/performance-matrix-${Date.now()}`;
  const json = JSON.stringify({ failureRateTarget, results }, null, 2);
  await Promise.all([writeFile(`${base}.json`, json), writeFile(`${base}.html`, matrixHtml(results))]);
  await testInfo.attach('performance-matrix-json', { body: json, contentType: 'application/json' });
  await testInfo.attach('performance-matrix-html', { path: `${base}.html`, contentType: 'text/html' });
}

function matrixHtml(results: Result[]) {
  const rows = results.map(result => `<tr class="${result.passed ? 'pass' : 'fail'}"><td>${result.profile}</td><td>${result.virtualUsers}</td><td>${result.totals.operations}</td><td>${result.throughputOpsPerSecond.toFixed(2)}</td><td>${result.latencyMs.p90.toFixed(0)}</td><td>${result.latencyMs.p95.toFixed(0)}</td><td>${result.latencyMs.p99.toFixed(0)}</td><td>${(result.errorRate * 100).toFixed(2)}%</td><td>${result.runtimeErrors.length}</td><td>${result.passed ? 'PASS' : 'FAIL'}</td></tr>`).join('');
  const operationRows = results.flatMap(result => [...new Set(result.samples.map(sample => sample.operation))].map(operation => {
    const values = result.samples.filter(sample => sample.operation === operation && sample.ok).map(sample => sample.durationMs);
    return `<tr><td>${result.profile}</td><td>${result.virtualUsers}</td><td>${operation}</td><td>${percentile(values, .90).toFixed(0)}</td><td>${percentile(values, .95).toFixed(0)}</td><td>${percentile(values, .99).toFixed(0)}</td></tr>`;
  })).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Performance matrix</title><style>body{font:14px system-ui;background:#0b1220;color:#e5edf8;max-width:1200px;margin:40px auto}table{width:100%;border-collapse:collapse;margin:20px 0 36px}th,td{padding:10px;border-bottom:1px solid #334155;text-align:left}.pass td:last-child{color:#4ade80}.fail td:last-child{color:#fb7185}h1,h2{text-transform:capitalize}</style></head><body><h1>Load, stress & spike comparison</h1><p>Acceptance: failed operations &lt; ${(failureRateTarget * 100).toFixed(2)}% and zero browser/network/HTTP 5xx errors.</p><table><thead><tr><th>Test</th><th>Users</th><th>Operations</th><th>Ops/sec</th><th>p90 ms</th><th>p95 ms</th><th>p99 ms</th><th>Failure rate</th><th>Runtime errors</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><h2>Per-operation percentiles</h2><table><thead><tr><th>Test</th><th>Users</th><th>Operation</th><th>p90 ms</th><th>p95 ms</th><th>p99 ms</th></tr></thead><tbody>${operationRows}</tbody></table></body></html>`;
}
