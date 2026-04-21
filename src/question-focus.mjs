const ANSWER_NAME_PATTERN = /answer|response|reply|submit/i;

export async function focusAnswerInput(page) {
  const candidates = [
    () => page.getByRole('textbox', { name: ANSWER_NAME_PATTERN }).first(),
    () => page.locator('[role="textbox"][contenteditable="true"]').first(),
    () => page.locator('textarea').first(),
    () => page.locator('input:not([type]), input[type="text"], input[type="search"]').first(),
  ];

  for (const createLocator of candidates) {
    const locator = createLocator();
    if ((await locator.count()) === 0) {
      continue;
    }

    const isVisible = await locator.isVisible().catch(() => false);
    if (!isVisible) {
      continue;
    }

    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await locator.click().catch(() => undefined);
    return true;
  }

  return false;
}
