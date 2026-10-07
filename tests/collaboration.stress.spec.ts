import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { LoginPage } from './pages/login.page';
import { PresentationEditorPage } from './pages/presentation-editor.page';
import { PresentationsPage } from './pages/presentations.page';
import { createStressSummary, measure, type Sample, type StressSummary } from './support/stress-metrics';
import { createPerformanceReport } from './support/stress-report';

const collaborators = [
  'aasamsha@yopmail.com',
  'saurav@yopmail.com',
  'shiva@yopmail.com',
  'sudip@yopmail.com',
  'suraj@yopmail.com',
  'performanceuser1@yopmail.com',
  'performanceuser2@yopmail.com',
  'performanceuser3@yopmail.com',
  'performanceuser4@yopmail.com',
  'performanceuser5@yopmail.com'
];
const presentationName = process.env.PRESENTATION_NAME ?? 'Taco Bell';
const presentationTitle = new RegExp(`^${presentationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const defaultAiPrompt = 'Add a small circle element in an unused area of the current slide.';

type CollaboratorSession = {
  user: string;
  context: BrowserContext;
  page: Page;
  editor: PresentationEditorPage;
};

async function signInAndOpenPresentation(page: Page, email: string, password: string) {
  await new LoginPage(page).signIn(email, password);
  await new PresentationsPage(page).openPresentation(presentationTitle);

  const editor = new PresentationEditorPage(page, presentationTitle);
  await editor.expectLoaded();
  return editor;
}

async function performTemporaryShapeEdit(editor: PresentationEditorPage) {
  await editor.addShape();
  await editor.moveSelectedElement();
  await editor.deleteSelectedElement();
}

test('@smoke shared collaborator can open the target deck', async ({ page }) => {
  const password = process.env.COLLABORATOR_PASSWORD;
  test.skip(!password, 'Set COLLABORATOR_PASSWORD');

  const editor = await signInAndOpenPresentation(page, collaborators[0], password!);
  await editor.expectSlideText('Taco Bell');
});

test('@editing collaborator can add, move, delete, and use AI to add an element', async ({ page }) => {
  test.skip(process.env.ENABLE_MUTATION_TESTS !== 'true', 'Set ENABLE_MUTATION_TESTS=true for deck-editing tests');
  const password = process.env.COLLABORATOR_PASSWORD;
  test.skip(!password, 'Set COLLABORATOR_PASSWORD');

  const editor = await signInAndOpenPresentation(page, collaborators[0], password!);
  await performTemporaryShapeEdit(editor);
  await editor.addElementWithAI(process.env.AI_EDIT_PROMPT ?? defaultAiPrompt);
});

test('@stress concurrent collaborators can use the same deck within SLOs', async ({ browser }, testInfo) => {
  const password = process.env.COLLABORATOR_PASSWORD;
  test.skip(!password, 'Set COLLABORATOR_PASSWORD');

  const virtualUsers = Math.max(1, Number(process.env.VIRTUAL_USERS ?? collaborators.length));
  const durationMs = Math.max(5_000, Number(process.env.STRESS_DURATION_MS ?? 60_000));
  const intervalMs = Math.max(100, Number(process.env.ACTION_INTERVAL_MS ?? 1_500));
  const p95Target = Number(process.env.P95_TARGET_MS ?? 3_000);
  const errorRateTarget = Number(process.env.ERROR_RATE_TARGET ?? 0.05);
  const samples: Sample[] = [];
  const runtimeErrors: StressSummary['runtimeErrors'] = [];

  const sessions = await Promise.all(Array.from({ length: virtualUsers }, async (_, index) => {
    const user = collaborators[index % collaborators.length];
    const context = await browser.newContext();
    const page = await context.newPage();
    monitorRuntimeErrors(page, user, runtimeErrors);

    let editor = new PresentationEditorPage(page, presentationTitle);
    await measure(samples, user, 'login', () => new LoginPage(page).signIn(user, password!));
    await measure(samples, user, 'open-deck', async () => {
      await new PresentationsPage(page).openPresentation(presentationTitle);
      editor = new PresentationEditorPage(page, presentationTitle);
      await editor.expectLoaded();
    });
    return { user, context, page, editor };
  }));

  if (process.env.ENABLE_MUTATION_TESTS === 'true') {
    await runConcurrentEdits(sessions, samples);
  }

  const deadline = Date.now() + durationMs;
  await Promise.all(sessions.map(async ({ user, page, editor }, index) => {
    let direction: 'ArrowUp' | 'ArrowDown' = index % 2 ? 'ArrowUp' : 'ArrowDown';
    while (Date.now() < deadline) {
      await measure(samples, user, 'navigate-slide', () => editor.navigateSlide(direction));
      direction = direction === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown';
      await page.waitForTimeout(intervalMs);
    }
  }));

  await Promise.all(sessions.map(session => session.context.close()));
  const summary = createStressSummary({ presentation: presentationName, virtualUsers, durationMs, samples, runtimeErrors });
  await saveAndAttachReport(summary, p95Target, errorRateTarget, testInfo);

  expect(summary.errorRate, `Error rate ${summary.errorRate} exceeded ${errorRateTarget}`).toBeLessThanOrEqual(errorRateTarget);
  expect(summary.latencyMs.p95, `p95 ${summary.latencyMs.p95}ms exceeded ${p95Target}ms`).toBeLessThanOrEqual(p95Target);
  expect(runtimeErrors, 'Browser/network errors occurred during collaboration').toEqual([]);
});

function monitorRuntimeErrors(page: Page, user: string, errors: StressSummary['runtimeErrors']) {
  page.on('pageerror', error => errors.push({ user, kind: 'pageerror', message: error.message }));
  page.on('requestfailed', request => {
    const message = request.failure()?.errorText ?? 'unknown error';
    if (message !== 'net::ERR_ABORTED') errors.push({ user, kind: 'requestfailed', message: `${request.method()} ${request.url()} ${message}` });
  });
  page.on('response', response => {
    if (response.status() >= 500) errors.push({ user, kind: 'http5xx', message: `${response.status()} ${response.url()}` });
  });
}

async function runConcurrentEdits(sessions: CollaboratorSession[], samples: Sample[]) {
  const aiPrompt = process.env.AI_EDIT_PROMPT ?? defaultAiPrompt;
  const manualEdit = async ({ user, editor }: CollaboratorSession) => {
    const added = await measure(samples, user, 'add-shape', () => editor.addShape());
    if (!added) return;
    const moved = await measure(samples, user, 'move-selected-element', () => editor.moveSelectedElement());
    if (moved) await measure(samples, user, 'delete-selected-element', () => editor.deleteSelectedElement());
  };

  if (sessions.length === 1) {
    await manualEdit(sessions[0]);
    await measure(samples, sessions[0].user, 'ai-add-element', () => sessions[0].editor.addElementWithAI(aiPrompt));
    return;
  }
  await Promise.all([
    measure(samples, sessions[0].user, 'ai-add-element', () => sessions[0].editor.addElementWithAI(aiPrompt)),
    ...sessions.slice(1).map(manualEdit),
  ]);
}

async function saveAndAttachReport(
  summary: StressSummary,
  p95Target: number,
  errorRateTarget: number,
  testInfo: TestInfo,
) {
  await mkdir('stress-results', { recursive: true });
  const reportBase = `stress-results/collaboration-${Date.now()}`;
  await Promise.all([
    writeFile(`${reportBase}.json`, JSON.stringify(summary, null, 2)),
    writeFile(`${reportBase}.html`, createPerformanceReport(summary, p95Target, errorRateTarget)),
  ]);
  await testInfo.attach('stress-summary', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  await testInfo.attach('performance-report', { path: `${reportBase}.html`, contentType: 'text/html' });
}
