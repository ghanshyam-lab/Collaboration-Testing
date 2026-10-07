import { expect, type Page } from '@playwright/test';

export class PresentationEditorPage {
  constructor(
    private readonly page: Page,
    private readonly presentationTitle: RegExp,
  ) {}

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/presentation\?id=/);
    await expect(this.title).toBeVisible();
  }

  async expectSlideText(text: string) {
    await expect(this.page.getByText(text, { exact: true }).first()).toBeVisible();
  }

  async addShape(shape = 'Rectangle') {
    await this.page.getByRole('button', { name: 'Elements', exact: true }).click();
    const addShapeButton = this.page.getByRole('button', { name: `Add ${shape}`, exact: true });

    await expect(addShapeButton).toBeVisible();
    await addShapeButton.click();
  }

  async moveSelectedElement() {
    // Small keyboard steps make movement deterministic across test runs.
    await this.page.keyboard.press('ArrowRight');
    await this.page.keyboard.press('ArrowRight');
    await this.page.keyboard.press('ArrowDown');
  }

  async deleteSelectedElement() {
    await this.page.keyboard.press('Delete');
  }

  async addElementWithAI(prompt: string) {
    await this.page.getByRole('button', { name: 'AI', exact: true }).click();
    const promptInput = this.page.getByPlaceholder('Prompt');

    await expect(promptInput).toBeVisible();
    await promptInput.fill(prompt);
    await promptInput.press('Enter');
    await expect(this.page.getByText(prompt, { exact: true }).last()).toBeVisible();
    await expect(promptInput).toBeEnabled({ timeout: 120_000 });
  }

  async navigateSlide(direction: 'ArrowUp' | 'ArrowDown') {
    await this.page.keyboard.press(direction);
    await this.page.waitForTimeout(100);
    await expect(this.title).toBeVisible();
  }

  private get title() {
    return this.page.getByText(this.presentationTitle).first();
  }
}
