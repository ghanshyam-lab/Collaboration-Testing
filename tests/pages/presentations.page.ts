import { expect, type Page } from '@playwright/test';

export class PresentationsPage {
  constructor(private readonly page: Page) {}

  async openPresentation(title: RegExp) {
    await this.page.goto('/presentations', { waitUntil: 'domcontentloaded' });
    const presentationCard = this.page.getByText(title).first();

    await expect(presentationCard).toBeVisible();
    await presentationCard.click();
  }
}
