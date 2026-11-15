import {
  DEFAULT_THREE_FINGER_CONTROL_MAP,
  DEFAULT_TWO_FINGER_CONTROL_MAP,
  InputSettings,
  TouchControlId,
  TouchControlLayoutMap,
  TouchControlNodeConfig,
} from '@/src/schemas/settings.schema';

export type TouchInteractionZone = 'left_move' | 'left_claw' | 'right_aim' | 'bottom_center';

export type TouchControlAnchor =
  | 'bottom_left'
  | 'top_left'
  | 'bottom_right'
  | 'bottom_center'
  | 'center';

export interface ComputedTouchControlRect {
  id: TouchControlId;
  label: string;
  shortLabel: string;
  zone: TouchInteractionZone;
  anchor: TouchControlAnchor;
  visible: boolean;
  zIndex: number;
  minHitboxPx: number;
  priority: number;
  normalized: TouchControlNodeConfig;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface HudLayoutViewportInput {
  width: number;
  height: number;
  safeTop?: number;
  safeBottom?: number;
  safeLeft?: number;
  safeRight?: number;
}

export interface HudLayoutOptions {
  inVehicle?: boolean;
  grenadeCount?: number;
  c4DeployedCount?: number;
}

export interface ComputedMobileHudLayout {
  viewportWidth: number;
  viewportHeight: number;
  safeBounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  topHudKeepOutBottomPx: number;
  topLeftHudLeftPx: number;
  leftMoveZoneTopPx: number;
  leftMoveZoneRightRatio: number;
  controls: Record<TouchControlId, ComputedTouchControlRect>;
  visibleControls: ComputedTouchControlRect[];
  collisionsResolved: number;
  overlappingPairs: Array<[TouchControlId, TouchControlId]>;
}

const CONTROL_METADATA: Record<
  TouchControlId,
  {
    label: string;
    shortLabel: string;
    zone: TouchInteractionZone;
    anchor: TouchControlAnchor;
    zIndex: number;
    minHitboxPx: number;
    priority: number;
  }
> = {
  move_joystick: {
    label: 'Left Analog Stick',
    shortLabel: 'MOVE',
    zone: 'left_move',
    anchor: 'bottom_left',
    zIndex: 24,
    minHitboxPx: 96,
    priority: 10,
  },
  fire_left: {
    label: 'Left Index Fire',
    shortLabel: 'L-FIRE',
    zone: 'left_claw',
    anchor: 'top_left',
    zIndex: 28,
    minHitboxPx: 56,
    priority: 10,
  },
  fire_right: {
    label: 'Right Thumb Fire',
    shortLabel: 'R-FIRE',
    zone: 'right_aim',
    anchor: 'bottom_right',
    zIndex: 28,
    minHitboxPx: 56,
    priority: 10,
  },
  ads: {
    label: 'Aim Down Sights',
    shortLabel: 'ADS',
    zone: 'right_aim',
    anchor: 'bottom_right',
    zIndex: 27,
    minHitboxPx: 46,
    priority: 8,
  },
  weapon_bar: {
    label: 'Weapon & Tactical Bar',
    shortLabel: 'WEAPON / KIT',
    zone: 'bottom_center',
    anchor: 'bottom_center',
    zIndex: 26,
    minHitboxPx: 44,
    priority: 9,
  },
  reload: {
    label: 'Reload Weapon',
    shortLabel: 'RELOAD',
    zone: 'right_aim',
    anchor: 'bottom_right',
    zIndex: 25,
    minHitboxPx: 44,
    priority: 6,
  },
  crouch: {
    label: 'Crouch / Slide',
    shortLabel: 'CROUCH',
    zone: 'right_aim',
    anchor: 'bottom_right',
    zIndex: 25,
    minHitboxPx: 44,
    priority: 6,
  },
  jump: {
    label: 'Jump',
    shortLabel: 'JUMP',
    zone: 'right_aim',
    anchor: 'bottom_right',
    zIndex: 25,
    minHitboxPx: 44,
    priority: 6,
  },
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function resolveActiveControlMap(input: InputSettings): TouchControlLayoutMap {
  if (input.touchControlProfile === 'three_finger') {
    const base = DEFAULT_THREE_FINGER_CONTROL_MAP;
    return {
      move_joystick: { ...base.move_joystick },
      fire_left: {
        ...base.fire_left,
        x: input.touchFirePosThreeFinger?.x ?? base.fire_left.x,
        y: input.touchFirePosThreeFinger?.y ?? base.fire_left.y,
      },
      fire_right: {
        ...base.fire_right,
        x: input.touchFirePosTwoFinger?.x ?? base.fire_right.x,
        y: input.touchFirePosTwoFinger?.y ?? base.fire_right.y,
      },
      ads: {
        ...base.ads,
        x: input.touchAdsPosThreeFinger?.x ?? base.ads.x,
        y: input.touchAdsPosThreeFinger?.y ?? base.ads.y,
      },
      reload: { ...base.reload },
      crouch: { ...base.crouch },
      jump: { ...base.jump },
      weapon_bar: { ...base.weapon_bar },
    };
  }

  if (input.touchControlProfile === 'two_finger') {
    const base = DEFAULT_TWO_FINGER_CONTROL_MAP;
    return {
      move_joystick: { ...base.move_joystick },
      fire_left: {
        ...base.fire_left,
        x: input.touchFirePosThreeFinger?.x ?? base.fire_left.x,
        y: input.touchFirePosThreeFinger?.y ?? base.fire_left.y,
      },
      fire_right: {
        ...base.fire_right,
        x: input.touchFirePosTwoFinger?.x ?? base.fire_right.x,
        y: input.touchFirePosTwoFinger?.y ?? base.fire_right.y,
      },
      ads: {
        ...base.ads,
        x: input.touchAdsPosTwoFinger?.x ?? base.ads.x,
        y: input.touchAdsPosTwoFinger?.y ?? base.ads.y,
      },
      reload: { ...base.reload },
      crouch: { ...base.crouch },
      jump: { ...base.jump },
      weapon_bar: { ...base.weapon_bar },
    };
  }

  // Custom profile uses touchCustomLayout with fallback to two-finger defaults
  const custom = input.touchCustomLayout ?? DEFAULT_TWO_FINGER_CONTROL_MAP;
  return {
    move_joystick: { ...(custom.move_joystick ?? DEFAULT_TWO_FINGER_CONTROL_MAP.move_joystick) },
    fire_left: { ...(custom.fire_left ?? DEFAULT_THREE_FINGER_CONTROL_MAP.fire_left) },
    fire_right: { ...(custom.fire_right ?? DEFAULT_TWO_FINGER_CONTROL_MAP.fire_right) },
    ads: { ...(custom.ads ?? DEFAULT_TWO_FINGER_CONTROL_MAP.ads) },
    reload: { ...(custom.reload ?? DEFAULT_TWO_FINGER_CONTROL_MAP.reload) },
    crouch: { ...(custom.crouch ?? DEFAULT_TWO_FINGER_CONTROL_MAP.crouch) },
    jump: { ...(custom.jump ?? DEFAULT_TWO_FINGER_CONTROL_MAP.jump) },
    weapon_bar: { ...(custom.weapon_bar ?? DEFAULT_TWO_FINGER_CONTROL_MAP.weapon_bar) },
  };
}

export function resolveFireVisibility(input: InputSettings): {
  leftFireVisible: boolean;
  rightFireVisible: boolean;
} {
  let left = Boolean(input.leftFireEnabled);
  let right = Boolean(input.rightFireEnabled);

  // Enforce non-negotiable safety invariant: at least one Fire control is always visible
  if (!left && !right) {
    if (input.touchControlProfile === 'three_finger') {
      left = true;
    } else {
      right = true;
    }
  }
  return { leftFireVisible: left, rightFireVisible: right };
}

function updateRectFromCenter(
  rect: ComputedTouchControlRect,
  cx: number,
  cy: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  minTopOverride?: number
): void {
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const minX = bounds.left + halfW;
  const maxX = Math.max(minX, bounds.right - halfW);
  const minY = (minTopOverride ?? bounds.top) + halfH;
  const maxY = Math.max(minY, bounds.bottom - halfH);

  const clampedCx = Math.round(clamp(cx, minX, maxX));
  const clampedCy = Math.round(clamp(cy, minY, maxY));

  rect.centerX = clampedCx;
  rect.centerY = clampedCy;
  rect.left = Math.round(clampedCx - halfW);
  rect.top = Math.round(clampedCy - halfH);
  rect.right = rect.left + rect.width;
  rect.bottom = rect.top + rect.height;
}

export function doRectsOverlap(
  a: Pick<ComputedTouchControlRect, 'left' | 'top' | 'right' | 'bottom'>,
  b: Pick<ComputedTouchControlRect, 'left' | 'top' | 'right' | 'bottom'>,
  minGapPx = 0
): boolean {
  return !(
    a.right + minGapPx <= b.left ||
    a.left >= b.right + minGapPx ||
    a.bottom + minGapPx <= b.top ||
    a.top >= b.bottom + minGapPx
  );
}

export function computeMobileHudLayout(
  input: InputSettings,
  viewport: HudLayoutViewportInput,
  options: HudLayoutOptions = {}
): ComputedMobileHudLayout {
  const vw = Math.max(320, Math.round(viewport.width || 844));
  const vh = Math.max(240, Math.round(viewport.height || 390));

  const safeLeft = Math.max(10, Math.round(viewport.safeLeft ?? 12));
  const safeRight = Math.max(10, Math.round(viewport.safeRight ?? 12));
  const safeTop = Math.max(8, Math.round(viewport.safeTop ?? 8));
  const safeBottom = Math.max(10, Math.round(viewport.safeBottom ?? 10));

  const safeBounds = {
    left: safeLeft,
    top: safeTop,
    right: vw - safeRight,
    bottom: vh - safeBottom,
  };

  // Account for reduced viewport height in in-app browsers (e.g., Instagram in-app browser ~310px tall)
  const heightCompactFactor = clamp(vh / 390, 0.8, 1.08);
  const topHudKeepOutBottomPx = Math.round(safeTop + clamp(vh * 0.14, 44, 58));

  const activeMap = resolveActiveControlMap(input);
  const { leftFireVisible, rightFireVisible } = resolveFireVisibility(input);
  const inVehicle = Boolean(options.inVehicle);
  const grenadeCount = options.grenadeCount ?? 2;
  const c4DeployedCount = options.c4DeployedCount ?? 0;

  // Compute pixel dimensions for each control while enforcing >= 44px minimum touch hitboxes
  const stickSize = Math.round(
    clamp(116 * input.touchJoystickScale * activeMap.move_joystick.scale * heightCompactFactor, 96, 154)
  );
  const fireLeftSize = Math.round(
    clamp(
      70 * input.touchButtonScale * input.touchFireButtonScale * activeMap.fire_left.scale * heightCompactFactor,
      56,
      104
    )
  );
  const fireRightSize = Math.round(
    clamp(
      72 * input.touchButtonScale * input.touchFireButtonScale * activeMap.fire_right.scale * heightCompactFactor,
      56,
      108
    )
  );
  const adsSize = Math.round(
    clamp(50 * input.touchButtonScale * activeMap.ads.scale * heightCompactFactor, 46, 74)
  );
  const secondarySize = (nodeScale: number) =>
    Math.round(clamp(45 * input.touchButtonScale * nodeScale * heightCompactFactor, 44, 64));

  // Bottom-center tactical bar width adapts to active contextual items (Weapon Switch + Kit + optional Grenade/C4)
  const extraItemsCount = (grenadeCount > 0 ? 1 : 0) + (c4DeployedCount > 0 ? 1 : 0);
  const weaponBarHeight = Math.round(
    clamp(44 * input.touchButtonScale * activeMap.weapon_bar.scale * heightCompactFactor, 44, 56)
  );
  const weaponBarWidth = inVehicle
    ? 124
    : Math.round(
        clamp(
          (136 + extraItemsCount * 52) *
            Math.min(1.12, input.touchButtonScale * activeMap.weapon_bar.scale * heightCompactFactor),
          132,
          Math.max(150, vw * 0.34)
        )
      );

  const buildInitialRect = (
    id: TouchControlId,
    width: number,
    height: number,
    visible: boolean,
    extraOffsetX = 0,
    extraOffsetY = 0
  ): ComputedTouchControlRect => {
    const meta = CONTROL_METADATA[id];
    const node = activeMap[id];
    const rawCx = node.x * vw + extraOffsetX;
    const rawCy = node.y * vh + extraOffsetY;
    const minTop = id === 'fire_left' ? safeBounds.top : Math.max(safeBounds.top, topHudKeepOutBottomPx);

    const rect: ComputedTouchControlRect = {
      id,
      label: meta.label,
      shortLabel: meta.shortLabel,
      zone: meta.zone,
      anchor: meta.anchor,
      visible,
      zIndex: meta.zIndex,
      minHitboxPx: meta.minHitboxPx,
      priority: meta.priority,
      normalized: { ...node },
      width: Math.max(meta.minHitboxPx, width),
      height: Math.max(meta.minHitboxPx, height),
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      centerX: 0,
      centerY: 0,
    };
    updateRectFromCenter(rect, rawCx, rawCy, safeBounds, minTop);
    return rect;
  };

  const fireOffsetX = input.touchFireOffsetX ?? 0;
  const fireOffsetY = input.touchFireOffsetY ?? 0;
  const adsOffsetX = input.touchAdsOffsetX ?? 0;
  const adsOffsetY = input.touchAdsOffsetY ?? 0;

  const controls: Record<TouchControlId, ComputedTouchControlRect> = {
    move_joystick: buildInitialRect('move_joystick', stickSize, stickSize, true),
    fire_left: buildInitialRect(
      'fire_left',
      fireLeftSize,
      fireLeftSize,
      leftFireVisible,
      input.touchControlProfile === 'three_finger' ? fireOffsetX : 0,
      input.touchControlProfile === 'three_finger' ? fireOffsetY : 0
    ),
    fire_right: buildInitialRect(
      'fire_right',
      fireRightSize,
      fireRightSize,
      rightFireVisible,
      input.touchControlProfile !== 'three_finger' ? fireOffsetX : 0,
      input.touchControlProfile !== 'three_finger' ? fireOffsetY : 0
    ),
    ads: buildInitialRect('ads', adsSize, adsSize, !inVehicle, adsOffsetX, adsOffsetY),
    weapon_bar: buildInitialRect('weapon_bar', weaponBarWidth, weaponBarHeight, true),
    reload: buildInitialRect('reload', secondarySize(activeMap.reload.scale), secondarySize(activeMap.reload.scale), !inVehicle),
    crouch: buildInitialRect('crouch', secondarySize(activeMap.crouch.scale), secondarySize(activeMap.crouch.scale), !inVehicle),
    jump: buildInitialRect('jump', secondarySize(activeMap.jump.scale), secondarySize(activeMap.jump.scale), !inVehicle),
  };

  // Enforce vertical separation between Left Index Fire (upper-left) and Left Move Stick (lower-left)
  if (controls.fire_left.visible && controls.move_joystick.visible) {
    const minStickTop = controls.fire_left.bottom + 10;
    if (controls.move_joystick.top < minStickTop && controls.fire_left.left < vw * 0.4) {
      updateRectFromCenter(
        controls.move_joystick,
        controls.move_joystick.centerX,
        Math.max(controls.move_joystick.centerY, minStickTop + controls.move_joystick.height / 2),
        safeBounds,
        topHudKeepOutBottomPx
      );
    }
  }

  // Keep all interactive controls out of the central 48x48px crosshair box
  const crosshairBox = {
    left: Math.round(vw / 2 - 24),
    right: Math.round(vw / 2 + 24),
    top: Math.round(vh / 2 - 24),
    bottom: Math.round(vh / 2 + 24),
  };

  const visibleList = (Object.values(controls) as ComputedTouchControlRect[]).filter((c) => c.visible);

  for (const ctrl of visibleList) {
    if (doRectsOverlap(ctrl, crosshairBox, 4)) {
      const pushDownY = crosshairBox.bottom + ctrl.height / 2 + 8;
      const minTop = ctrl.id === 'fire_left' ? safeBounds.top : topHudKeepOutBottomPx;
      updateRectFromCenter(ctrl, ctrl.centerX, pushDownY, safeBounds, minTop);
    }
  }

  // Deterministic iterative collision-resolution solver (guarantees >= 8px gap between interactive hitboxes)
  const minGapPx = 8;
  let collisionsResolved = 0;

  for (let iter = 0; iter < 18; iter++) {
    let anyMovedInPass = false;

    for (let i = 0; i < visibleList.length; i++) {
      for (let j = i + 1; j < visibleList.length; j++) {
        const a = visibleList[i];
        const b = visibleList[j];

        if (!doRectsOverlap(a, b, minGapPx)) continue;

        const overlapX =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) + minGapPx;
        const overlapY =
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + minGapPx;

        if (overlapX <= 0 || overlapY <= 0) continue;

        let dx = b.centerX - a.centerX;
        let dy = b.centerY - a.centerY;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          dx = j % 2 === 0 ? -12 : 12;
          dy = 12;
        }

        // Push along axis of least penetration (or radial vector for circular buttons)
        let pushX = 0;
        let pushY = 0;
        if (overlapX < overlapY) {
          pushX = (dx >= 0 ? 1 : -1) * (overlapX + 1);
        } else {
          pushY = (dy >= 0 ? 1 : -1) * (overlapY + 1);
        }

        // Weight displacement by inverse priority so primary controls (Fire, Joystick) stay stable
        const totalPrio = a.priority + b.priority;
        const weightA = a.priority > b.priority ? 0.15 : a.priority < b.priority ? 0.85 : 0.5;
        const weightB = totalPrio > 0 ? 1 - weightA : 0.5;

        const minTopA = a.id === 'fire_left' ? safeBounds.top : topHudKeepOutBottomPx;
        const minTopB = b.id === 'fire_left' ? safeBounds.top : topHudKeepOutBottomPx;

        updateRectFromCenter(
          a,
          a.centerX - pushX * weightA,
          a.centerY - pushY * weightA,
          safeBounds,
          minTopA
        );
        updateRectFromCenter(
          b,
          b.centerX + pushX * weightB,
          b.centerY + pushY * weightB,
          safeBounds,
          minTopB
        );

        collisionsResolved++;
        anyMovedInPass = true;
      }
    }

    if (!anyMovedInPass) break;
  }

  // Record any residual zero-gap overlaps (should be 0 across all supported viewports)
  const overlappingPairs: Array<[TouchControlId, TouchControlId]> = [];
  for (let i = 0; i < visibleList.length; i++) {
    for (let j = i + 1; j < visibleList.length; j++) {
      if (doRectsOverlap(visibleList[i], visibleList[j], 0)) {
        overlappingPairs.push([visibleList[i].id, visibleList[j].id]);
      }
    }
  }

  // Compute Top-Left HUD shift & Left Move Zone boundary when Left Fire is active in the upper-left quadrant
  const fireLeft = controls.fire_left;
  const leftFireInTopLeft =
    fireLeft.visible && fireLeft.left < vw * 0.36 && fireLeft.top < vh * 0.48;

  const topLeftHudLeftPx = leftFireInTopLeft
    ? Math.max(132, Math.round(fireLeft.right + 12))
    : safeLeft;

  const leftMoveZoneTopPx = leftFireInTopLeft
    ? Math.max(Math.round(vh * 0.44), Math.round(fireLeft.bottom + 8))
    : 0;

  return {
    viewportWidth: vw,
    viewportHeight: vh,
    safeBounds,
    topHudKeepOutBottomPx,
    topLeftHudLeftPx,
    leftMoveZoneTopPx,
    leftMoveZoneRightRatio: 0.4,
    controls,
    visibleControls: visibleList,
    collisionsResolved,
    overlappingPairs,
  };
}
