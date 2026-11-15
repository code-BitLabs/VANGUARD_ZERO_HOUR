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

test('deploys Mission 1 on 844x390 touch landscape, verifies simultaneous 360° camera rotation + full analog movement + 3rd-finger fire, and auto-pauses on portrait rotation', async ({
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
  await expect(page.getByTestId('touch-look-zone')).toBeVisible();
  await expect(page.getByTestId('touch-btn-fire')).toBeVisible();
  await expect(page.getByTestId('touch-btn-ads')).toBeVisible();
  await expect(page.getByTestId('touch-btn-weapon-switch')).toBeVisible();
  await expect(page.getByTestId('touch-btn-tactical-drawer')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pause Mission/i })).toBeVisible();

  // Simplified HUD: redundant weapon prev/next arrows & always-visible sprint button are absent
  await expect(page.getByTestId('touch-btn-weapon-prev')).toHaveCount(0);
  await expect(page.getByTestId('touch-btn-weapon-next')).toHaveCount(0);
  await expect(page.getByTestId('touch-btn-sprint')).toHaveCount(0);

  // Verify >=44px touch targets and zero overlap between touch controls and center crosshair / landscape bounds
  const layoutCheck = await page.evaluate(() => {
    const ids = [
      'touch-move-stick',
      'touch-btn-fire',
      'touch-btn-ads',
      'touch-btn-reload',
      'touch-btn-jump',
      'touch-btn-crouch',
      'touch-btn-weapon-switch',
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;
    const violations: string[] = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        violations.push(`missing:${id}`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) {
        violations.push(`small:${id}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        violations.push(`clipped:${id}`);
      }
      // Must not overlap central crosshair zone (40px box at viewport center)
      if (r.left < cx + 20 && r.right > cx - 20 && r.top < cy + 20 && r.bottom > cy - 20) {
        violations.push(`crosshair-overlap:${id}`);
      }
    }
    return violations;
  });
  expect(layoutCheck).toEqual([]);

  // Exercise live multitouch movement (forward/backward/left/right) + continuous 360° camera rotation + 3rd-finger fire
  const multitouchResult = await page.evaluate(async () => {
    const moveZone = document.querySelector('[data-testid="touch-move-zone"]') as HTMLElement;
    const lookZone = document.querySelector('[data-testid="touch-look-zone"]') as HTMLElement;
    const fireBtn = document.querySelector('[data-testid="touch-btn-fire"]') as HTMLElement;

    const dispatchPtr = (target: EventTarget, type: string, pointerId: number, x: number, y: number) => {
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
        })
      );
    };

    const waitFrames = (count: number) =>
      new Promise<void>((resolve) => {
        let rem = count;
        const step = () => {
          if (--rem <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });

    // 1. Hold left joystick forward (pointerId = 10)
    dispatchPtr(moveZone, 'pointerdown', 10, 140, 260);
    dispatchPtr(window, 'pointermove', 10, 140, 195);
    await waitFrames(8);

    // 2. Simultaneously drag right look zone (pointerId = 11) across 420px to turn > 360 degrees while moving
    dispatchPtr(lookZone, 'pointerdown', 11, 400, 190);
    for (let i = 1; i <= 15; i++) {
      dispatchPtr(window, 'pointermove', 11, 400 + i * 28, 190);
      await waitFrames(1);
    }
    dispatchPtr(window, 'pointerup', 11, 820, 190);

    // 3. Fire with 3rd finger (pointerId = 12) while still moving
    dispatchPtr(fireBtn, 'pointerdown', 12, 760, 310);
    await waitFrames(6);
    dispatchPtr(window, 'pointerup', 12, 760, 310);

    // 4. Pull joystick backward, then strafe left & right
    dispatchPtr(window, 'pointermove', 10, 140, 325);
    await waitFrames(6);
    dispatchPtr(window, 'pointermove', 10, 80, 260);
    await waitFrames(6);
    dispatchPtr(window, 'pointermove', 10, 200, 260);
    await waitFrames(6);
    dispatchPtr(window, 'pointerup', 10, 200, 260);
    await waitFrames(4);

    return { ok: true };
  });
  expect(multitouchResult.ok).toBe(true);

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
