import { expect, test } from '@playwright/test';

const LANDSCAPE_VIEWPORTS = [
  { name: 'Desktop 1080p', width: 1920, height: 1080, hasTouch: false },
  { name: 'Laptop 768p', width: 1366, height: 768, hasTouch: false },
  { name: 'Tablet 1024x768', width: 1024, height: 768, hasTouch: true },
  { name: 'Phone Landscape 844x390', width: 844, height: 390, hasTouch: true },
  { name: 'Pixel Landscape 915x412', width: 915, height: 412, hasTouch: true },
];

for (const vp of LANDSCAPE_VIEWPORTS) {
  test(`@responsive renders campaign onboarding, zero horizontal overflow, and clean console on ${vp.name}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.hasTouch,
      isMobile: vp.width < 950 && vp.hasTouch,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /VANGUARD/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(overflow).toBe(false);

    // First-time Play Campaign -> Campaign Briefing & Difficulty screen
    await page.getByRole('button', { name: /Play Campaign/i }).click();
    await expect(page.getByText(/Operation Briefing/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Deploy Operation/i })).toBeVisible();

    const briefingOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(briefingOverflow).toBe(false);

    // Open Settings & inspect Graphics Mode + Mobile Touch Controls
    await page.getByRole('button', { name: /HQ Menu/i }).click();
    await page.getByRole('button', { name: /Settings/i }).click();
    await expect(page.getByText(/Graphics Mode:/i)).toBeVisible();
    await page.getByRole('tab', { name: /Controls & Keys/i }).click();
    await expect(page.getByText(/Touch HUD Mode/i)).toBeVisible();

    expect(errors).toEqual([]);
    await context.close();
  });
}

test('enforces Rotate Device to Landscape gate on 390x844 mobile portrait and recovers cleanly on rotate back', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.getByRole('dialog', { name: /Rotate Device to Landscape/i })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('dialog', { name: /Rotate Device to Landscape/i })).toBeHidden();
  await expect(page.getByRole('button', { name: /Play Campaign/i })).toBeVisible();

  await context.close();
});

test('deploys Mission 1 on 844x390 touch landscape, renders twin-stick touch HUD, and auto-pauses if rotated to portrait', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await page.getByRole('button', { name: /Play Campaign/i }).click();
  await page.getByRole('button', { name: /Deploy Operation/i }).click();

  await expect(page.getByTestId('mobile-touch-controls')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('touch-move-stick')).toBeVisible();
  await expect(page.getByTestId('touch-btn-fire')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pause Mission/i })).toBeVisible();

  // Rotating into portrait mid-mission blocks with Rotate dialog and pauses the mission
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: /Rotate Device to Landscape/i })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('dialog', { name: /Rotate Device to Landscape/i })).toBeHidden();
  await expect(page.getByRole('heading', { name: /Mission Paused/i })).toBeVisible();

  await page.getByRole('button', { name: /Resume Combat/i }).click();
  await expect(page.getByTestId('mobile-touch-controls')).toBeVisible();

  expect(errors).toEqual([]);
  await context.close();
});
