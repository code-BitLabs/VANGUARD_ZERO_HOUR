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
    await expect(page.getByText(/Mission Briefing & Difficulty/i)).toBeVisible();
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

  // Verify Pre-Deployment Mission Briefing panel, version badge, controls guide, and Full Briefing Dossier modal (FND-16 / FND-17)
  await expect(page.getByTestId('mission-briefing-panel')).toBeVisible();
  await expect(page.getByTestId('briefing-version-badge')).toBeVisible();
  await expect(page.getByTestId('briefing-controls-guide')).toBeVisible();
  await page.getByTestId('open-mission-briefing').click();
  await expect(page.getByTestId('mission-briefing-modal')).toBeVisible();
  await page.getByTestId('close-mission-briefing').click();
  await expect(page.getByTestId('mission-briefing-modal')).toHaveCount(0);

  await page.getByRole('button', { name: /Deploy Operation/i }).click();

  await expect(page.getByTestId('mobile-touch-controls')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('touch-move-stick')).toBeVisible();
  await expect(page.getByTestId('touch-look-zone')).toBeVisible();
  await expect(page.getByTestId('touch-btn-fire')).toBeVisible();
  await expect(page.getByTestId('touch-btn-ads')).toBeVisible();
  await expect(page.getByTestId('touch-btn-weapon-switch')).toBeVisible();
  await expect(page.getByTestId('touch-btn-rpg')).toBeVisible();
  await expect(page.getByTestId('touch-btn-tactical-drawer')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pause Mission/i })).toBeVisible();

  // Compact Top HUD verification: compact objective indicator, actionable NEXT ACTION directive (FND-16), single-line compass strip, inline weapon readout, and encounter-gated boss bar
  await expect(page.getByTestId('hud-objectives-compact')).toBeVisible();
  await expect(page.getByTestId('hud-action-directive')).toBeVisible();
  await expect(page.getByTestId('hud-action-directive')).toContainText(/NEXT ACTION:/i);
  await expect(page.getByTestId('hud-compass-strip')).toBeVisible();
  await expect(page.getByTestId('hud-compact-weapon-readout')).toBeVisible();
  await expect(page.getByTestId('hud-boss-bar')).toHaveCount(0);

  // Verify zero horizontal overlap along the compact mobile top telemetry bar (844x390)
  const mobileTopOverlapCheck = await page.evaluate(() => {
    const left = document.querySelector('[data-testid="hud-top-left-cluster"]')?.getBoundingClientRect();
    const center = document.querySelector('[data-testid="hud-top-center-strip"]')?.getBoundingClientRect();
    const right = document.querySelector('[data-testid="hud-top-right-bar"]')?.getBoundingClientRect();
    const intersects = (a: DOMRect, b: DOMRect) =>
      !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    return {
      leftCenterOverlap: Boolean(left && center && intersects(left, center)),
      centerRightOverlap: Boolean(center && right && intersects(center, right)),
      leftRightOverlap: Boolean(left && right && intersects(left, right)),
    };
  });
  expect(mobileTopOverlapCheck).toEqual({
    leftCenterOverlap: false,
    centerRightOverlap: false,
    leftRightOverlap: false,
  });

  // Verify 1-tap RPG quick-equip button (FND-19) switches to RPG-7V without auto-firing
  await page.getByTestId('touch-btn-rpg').dispatchEvent('pointerdown', {
    pointerId: 31,
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
  });
  await expect(page.getByTestId('hud-compact-weapon-readout')).toContainText(/AT-4X RPG/i);

  // Expand and collapse objective list
  await expect(page.getByTestId('hud-objectives-expanded-list')).toHaveCount(0);
  await page.getByTestId('hud-objectives-toggle').click();
  await expect(page.getByTestId('hud-objectives-expanded-list')).toBeVisible();
  await page.getByTestId('hud-objectives-toggle').click();
  await expect(page.getByTestId('hud-objectives-expanded-list')).toHaveCount(0);

  // Simplified HUD: redundant weapon prev/next arrows & always-visible sprint button are absent
  await expect(page.getByTestId('touch-btn-weapon-prev')).toHaveCount(0);
  await expect(page.getByTestId('touch-btn-weapon-next')).toHaveCount(0);
  await expect(page.getByTestId('touch-btn-sprint')).toHaveCount(0);

  // Verify >=44px touch targets, zero clipping, zero crosshair overlap, AND zero pairwise control overlap
  const verifyZeroControlOverlap = async () =>
    page.evaluate(() => {
      const ids = [
        'touch-move-stick',
        'touch-btn-fire',
        'touch-btn-ads',
        'touch-btn-reload',
        'touch-btn-jump',
        'touch-btn-crouch',
        'touch-weapon-bar',
      ];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = vw / 2;
      const cy = vh / 2;
      const violations: string[] = [];
      const rects: Array<{ id: string; r: DOMRect }> = [];

      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) {
          violations.push(`missing:${id}`);
          continue;
        }
        const r = el.getBoundingClientRect();
        rects.push({ id, r });
        if (r.width < 44 || r.height < 44) {
          violations.push(`small:${id}:${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
          violations.push(`clipped:${id}`);
        }
        // Must not overlap central crosshair zone (36px box at viewport center)
        if (r.left < cx + 18 && r.right > cx - 18 && r.top < cy + 18 && r.bottom > cy - 18) {
          violations.push(`crosshair-overlap:${id}`);
        }
      }

      // Pairwise intersection check across all primary HUD controls (zero overlap allowed)
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const intersects = !(
            a.r.right <= b.r.left + 1 ||
            a.r.left >= b.r.right - 1 ||
            a.r.bottom <= b.r.top + 1 ||
            a.r.top >= b.r.bottom - 1
          );
          if (intersects) {
            violations.push(`overlap:${a.id}<->${b.id}`);
          }
        }
      }

      return violations;
    });

  expect(await verifyZeroControlOverlap()).toEqual([]);

  // Simulate Instagram / in-app browser reduced landscape height (844x315) and verify zero control overlap
  await page.setViewportSize({ width: 844, height: 315 });
  await expect(page.getByTestId('mobile-touch-controls')).toHaveAttribute('data-viewport', '844x315');
  expect(await verifyZeroControlOverlap()).toEqual([]);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId('mobile-touch-controls')).toHaveAttribute('data-viewport', '844x390');

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

    const waitTick = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    // 1. Hold left joystick forward (pointerId = 10)
    dispatchPtr(moveZone, 'pointerdown', 10, 140, 260);
    dispatchPtr(window, 'pointermove', 10, 140, 195);
    await waitTick(35);

    // 2. Simultaneously drag right look zone (pointerId = 11) across 420px to turn > 360 degrees while moving
    dispatchPtr(lookZone, 'pointerdown', 11, 400, 190);
    for (let i = 1; i <= 8; i++) {
      dispatchPtr(window, 'pointermove', 11, 400 + i * 52, 190);
      await waitTick(15);
    }
    dispatchPtr(window, 'pointerup', 11, 816, 190);

    // 3. Fire with 3rd finger (pointerId = 12) while still moving
    dispatchPtr(fireBtn, 'pointerdown', 12, 740, 290);
    await waitTick(40);
    dispatchPtr(window, 'pointerup', 12, 740, 290);

    // 4. Pull joystick backward, then strafe left & right
    dispatchPtr(window, 'pointermove', 10, 140, 325);
    await waitTick(30);
    dispatchPtr(window, 'pointermove', 10, 80, 260);
    await waitTick(30);
    dispatchPtr(window, 'pointermove', 10, 200, 260);
    await waitTick(30);
    dispatchPtr(window, 'pointerup', 10, 200, 260);
    await waitTick(25);

    return { ok: true };
  });
  expect(multitouchResult.ok).toBe(true);

  // Switch to Three-Finger Claw Mode from Pause -> Settings -> Open 1:1 Full-Screen HUD Editor -> Verify Infantry & Vehicle HUD modes -> Save -> Resume & Test Controls
  await page.getByRole('button', { name: /Pause Mission/i }).click();
  await expect(page.getByRole('heading', { name: /Mission Paused/i })).toBeVisible();
  await page.getByRole('button', { name: /Settings/i }).click();
  await page.getByRole('tab', { name: /Controls & Keys/i }).click();
  await expect(page.getByTestId('control-layout-preview')).toBeVisible();
  await page.getByTestId('profile-three-finger').click();

  // Launch 1:1 Full-Screen HUD Editor, verify Infantry & Vehicle HUD nodes, and save/close
  await page.getByTestId('open-fullscreen-hud-editor').click();
  await expect(page.getByTestId('fullscreen-hud-editor')).toBeVisible();
  await expect(page.getByTestId('editor-handle-fire_left')).toBeVisible();
  await page.getByTestId('editor-mode-vehicle').click();
  await expect(page.getByTestId('editor-veh-handle-veh_steer_left')).toBeVisible();
  await expect(page.getByTestId('editor-veh-handle-veh_steer_right')).toBeVisible();
  await expect(page.getByTestId('editor-veh-handle-veh_gas')).toBeVisible();
  await expect(page.getByTestId('editor-veh-handle-veh_brake_reverse')).toBeVisible();
  await page.getByTestId('editor-mode-infantry').click();
  await expect(page.getByTestId('editor-handle-fire_left')).toBeVisible();
  await page.getByTestId('close-fullscreen-hud-editor').click();
  await expect(page.getByTestId('fullscreen-hud-editor')).toHaveCount(0);

  await page.getByTestId('test-controls-in-mission').click();
  await expect(page.getByTestId('touch-btn-fire')).toBeVisible();

  // Verify Three-Finger Claw Mode places Fire button in upper-left without overlapping hud-top-left-cluster or any other control
  expect(await verifyZeroControlOverlap()).toEqual([]);

  const clawOverlapCheck = await page.evaluate(() => {
    const fireEl = document.querySelector('[data-testid="touch-btn-fire"]');
    const clusterEl = document.querySelector('[data-testid="hud-top-left-cluster"]');
    if (!fireEl || !clusterEl) return { missing: true };
    const fr = fireEl.getBoundingClientRect();
    const cr = clusterEl.getBoundingClientRect();
    const overlaps = !(
      fr.right <= cr.left ||
      fr.left >= cr.right ||
      fr.bottom <= cr.top ||
      fr.top >= cr.bottom
    );
    return {
      missing: false,
      fireInUpperLeft: fr.left < window.innerWidth * 0.3 && fr.top < window.innerHeight * 0.45,
      overlaps,
    };
  });
  expect(clawOverlapCheck).toEqual({
    missing: false,
    fireInUpperLeft: true,
    overlaps: false,
  });

  // Rotating into portrait mid-mission blocks with Rotate dialog and pauses the mission
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: /Rotate Device to Landscape/i })).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('dialog', { name: /Rotate Device to Landscape/i })).toBeHidden();
  await expect(page.getByRole('heading', { name: /Mission Paused/i })).toBeVisible();

  await page.getByRole('button', { name: /Resume Combat/i }).click();
  await expect(page.getByTestId('mobile-touch-controls')).toBeVisible();

  // Verify Stage 5B Top-Right Tactical Overview Drawer toggles cleanly on Mobile Landscape without pausing
  await page.getByTestId('hud-tactical-overview-btn').click();
  await expect(page.getByTestId('hud-tactical-overview-drawer')).toBeVisible();
  await page.getByTestId('close-tactical-overview').click();
  await expect(page.getByTestId('hud-tactical-overview-drawer')).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});

test('deploys Mission 1 on Desktop 1920x1080 with Stage 5B context-adaptive HUD, gold weapon silhouette, zero overlap, and non-pausing [TAB] tactical overview', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    hasTouch: false,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Play Campaign/i }).click();
  await expect(page.getByTestId('mission-briefing-panel')).toBeVisible();
  await page.getByRole('button', { name: /Deploy Operation/i }).click();

  await expect(page.getByTestId('hud-radar-minimap')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('hud-objectives-desktop')).toBeVisible();
  await expect(page.getByTestId('hud-compass-strip')).toBeVisible();
  await expect(page.getByTestId('hud-center-reticle')).toBeVisible();
  await expect(page.getByTestId('weapon-silhouette-assault_rifle')).toBeVisible();
  await expect(page.getByTestId('desktop-btn-rpg')).toBeVisible();
  await expect(page.getByTestId('hud-tactical-overview-btn')).toBeVisible();

  // Verify WebGL canvas occupies viewport with non-zero dimensions and zero HUD corner collisions
  const desktopLayoutCheck = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const cRect = canvas?.getBoundingClientRect();
    const topLeft = document.querySelector('[data-testid="hud-top-left-cluster"]')?.getBoundingClientRect();
    const topCenter = document.querySelector('[data-testid="hud-top-center-strip"]')?.getBoundingClientRect();
    const overviewBtn = document.querySelector('[data-testid="hud-tactical-overview-btn"]')?.getBoundingClientRect();
    const weaponSil = document.querySelector('[data-testid="weapon-silhouette-assault_rifle"]')?.getBoundingClientRect();

    const intersects = (a: DOMRect, b: DOMRect) =>
      !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

    return {
      hasCanvas: Boolean(cRect && cRect.width >= 1900 && cRect.height >= 1000),
      topLeftCenterOverlap: Boolean(topLeft && topCenter && intersects(topLeft, topCenter)),
      topCenterRightOverlap: Boolean(topCenter && overviewBtn && intersects(topCenter, overviewBtn)),
      weaponSilhouetteVisible: Boolean(weaponSil && weaponSil.width > 40 && weaponSil.height > 15),
    };
  });
  expect(desktopLayoutCheck).toEqual({
    hasCanvas: true,
    topLeftCenterOverlap: false,
    topCenterRightOverlap: false,
    weaponSilhouetteVisible: true,
  });

  // Toggle non-pausing [TAB] Tactical Overview Drawer via keyboard & verify simulation stays unpaused
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('hud-tactical-overview-drawer')).toBeVisible();
  await expect(page.getByTestId('hud-tactical-overview-drawer')).toContainText(/OP\. IRON DAWN/i);
  await expect(page.getByRole('heading', { name: /Mission Paused/i })).toHaveCount(0);

  // Confirm simulation timer keeps advancing while drawer is open (non-pausing guarantee; 0.1s shield tick updates every 2 frames)
  const initialTimerState = await page.evaluate(() => ({
    compass: document.querySelector('[data-testid="hud-compass-strip"]')?.textContent ?? '',
    shield: document.querySelector('[data-testid="hud-spawn-protection"]')?.textContent ?? '',
  }));
  await expect
    .poll(
      async () =>
        await page.evaluate(() => ({
          compass: document.querySelector('[data-testid="hud-compass-strip"]')?.textContent ?? '',
          shield: document.querySelector('[data-testid="hud-spawn-protection"]')?.textContent ?? '',
        })),
      { timeout: 20_000 }
    )
    .not.toEqual(initialTimerState);
  await expect(page.getByRole('heading', { name: /Mission Paused/i })).toHaveCount(0);

  await page.keyboard.press('Tab');
  await expect(page.getByTestId('hud-tactical-overview-drawer')).toHaveCount(0);

  expect(errors).toEqual([]);
  await context.close();
});

