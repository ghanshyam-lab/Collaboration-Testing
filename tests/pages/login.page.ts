import { type Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async signIn(email: string, password: string) {
    await this.page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await this.page.locator('input[type="email"]').fill(email);
    await this.page.locator('input[type="password"]').fill(password);

    await Promise.all([
      this.page.waitForURL(url => !url.pathname.includes('/auth/login'), { timeout: 30_000 }),
      this.page.getByRole('button', { name: 'Sign In', exact: true }).click(),
    ]);
  }
}
