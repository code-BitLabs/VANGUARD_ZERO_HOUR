import { beforeEach, describe, expect, it } from 'vitest';
import { ResourceManager } from '@/src/core/ResourceManager';
import { InputManager } from '@/src/engine/InputManager';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';
import { progressionStore } from '@/src/stores/progressionStore';

describe('Progression Store & InputManager', () => {
  beforeEach(() => {
    progressionStore.getState().resetAllProgress();
  });

  it('records mission completion, awards XP/REQ, unlocks achievements, and upgrades weapons', () => {
    const beforeReq = progressionStore.getState().save.requisitionPoints;
    expect(beforeReq).toBe(500);

    const upgraded = progressionStore.getState().upgradeWeapon('assault_rifle', 'damage');
    expect(upgraded).toBe(true);
    expect(progressionStore.getState().getUpgradeLevel('assault_rifle', 'damage')).toBe(1);
    expect(progressionStore.getState().save.requisitionPoints).toBe(400);

    const { newAchievements } = progressionStore.getState().recordMissionResult({
      missionId: 1,
      difficulty: 'normal',
      victory: true,
      score: 2800,
      grade: 'S',
      xpEarned: 900,
      requisitionEarned: 350,
      kills: 15,
      headshots: 6,
      airKills: 3,
      durationSec: 185,
    });

    expect(newAchievements).toContain('first_blood');
    expect(newAchievements).toContain('sharpshooter');
    expect(newAchievements).toContain('sky_sweeper');
    expect(newAchievements).toContain('s_rank_elite');
    expect(progressionStore.getState().save.xp).toBe(900);
    expect(progressionStore.getState().save.missionRecords['1']?.bestGrade).toBe('S');
  });

  it('supports dynamic key rebinding and clears held inputs on window blur', () => {
    const rm = new ResourceManager();
    const settings = SettingsBundleSchema.parse({}).input;
    const input = new InputManager(rm, settings);
    const dummyCanvas = document.createElement('div');
    input.attach(dummyCanvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(input.getMoveAxes().forward).toBe(1);

    // Window blur must clear stuck keys immediately
    window.dispatchEvent(new Event('blur'));
    expect(input.getMoveAxes().forward).toBe(0);

    // Rebind forward to ArrowUp
    input.updateSettings({
      ...settings,
      bindings: { ...settings.bindings, forward: 'ArrowUp' },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    expect(input.getMoveAxes().forward).toBe(1);

    rm.disposeAll();
  });
});
