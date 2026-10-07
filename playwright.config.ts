import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

export default defineConfig({
  testDir: './tests',
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Keep the browser visible for local performance runs. Set HEADLESS=true in CI.
    headless: process.env.HEADLESS === 'true',
    baseURL: process.env.BASE_URL ?? 'https://enterprise.saurav-niraula.com.np/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'smoke', grep: /@smoke/ },
    { name: 'stress', grep: /@stress/ },
    { name: 'performance', grep: /@performance/ },
    { name: 'editing', grep: /@editing/ },
  ],
});
