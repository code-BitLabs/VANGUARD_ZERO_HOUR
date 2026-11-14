import { describe, expect, it } from 'vitest';
import { ENEMY_CATALOG } from '@/src/data/enemies';
import { MISSION_CATALOG } from '@/src/data/missions';
import { WEAPON_CATALOG } from '@/src/data/weapons';
import { migrateProgressionSave } from '@/src/schemas/save.schema';
import { SettingsBundleSchema } from '@/src/schemas/settings.schema';

describe('Zod 4 Schemas & Save Migration', () => {
  it('validates all 9 weapons, 7 enemy archetypes, and 5 campaign missions', () => {
    expect(WEAPON_CATALOG).toHaveLength(9);
    expect(ENEMY_CATALOG).toHaveLength(7);
    expect(MISSION_CATALOG).toHaveLength(5);
    expect(MISSION_CATALOG.map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('migrates v1 progression save cleanly to v2 schema', () => {
    const res = migrateProgressionSave({
      version: 1,
      xp: 1450,
      requisitionPoints: 720,
      achievements: ['first_blood'],
      missionRecords: {
        '1': { missionId: 1, completed: true, bestScore: 2200, bestGrade: 'A' },
      },
      weaponUpgrades: {
        assault_rifle: { damage: 2, recoil: 1, capacity: 0, reload: 0 },
      },
    });
    expect(res.migratedFromV1).toBe(true);
    expect(res.recoveredFromCorruption).toBe(false);
    expect(res.save.version).toBe(2);
    expect(res.save.xp).toBe(1450);
    expect(res.save.missionRecords['1']?.bestGrade).toBe('A');
  });

  it('recovers safely from corrupted save payload without throwing', () => {
    const res = migrateProgressionSave({ version: 99, xp: -500, badField: 'corrupt' });
    expect(res.recoveredFromCorruption).toBe(true);
    expect(res.save.version).toBe(2);
    expect(res.save.xp).toBe(0);
    expect(res.save.requisitionPoints).toBe(500);
  });

  it('parses default settings bundle with complete key bindings', () => {
    const def = SettingsBundleSchema.parse({});
    expect(def.graphics.fov).toBe(78);
    expect(def.input.bindings.forward).toBe('KeyW');
    expect(def.accessibility.colorblindMode).toBe('standard');
  });
});
