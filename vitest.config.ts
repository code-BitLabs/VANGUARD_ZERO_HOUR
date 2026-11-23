import { defineConfig } from 'vitest/config';
import path from 'path';

const alias = {
  '@': path.resolve(import.meta.dirname, '.'),
};

const JSDOM_TS_FILES = [
  'src/tests/adaptiveGraphicsAndLifecycle.test.ts',
  'src/tests/auditStabilization.test.ts',
  'src/tests/combat.test.ts',
  'src/tests/performanceBudgets.test.ts',
  'src/tests/physicsOverhaul.test.ts',
  'src/tests/playerFeedbackRepairs.test.ts',
  'src/tests/stage2And3Batch.test.ts',
  'src/tests/stage4SurvivabilityAndUx.test.ts',
  'src/tests/stage5dSustainmentMusicVehicles.test.ts',
  'src/tests/stage7CampaignAndAttachments.test.ts',
  'src/tests/stores.test.ts',
  'src/tests/vaultTraversal.test.ts',
  'src/tests/weaponAndEnemyAnimation.test.ts',
];

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    maxWorkers: 2,
    testTimeout: 12000,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['src/tests/**/*.test.ts'],
          exclude: JSDOM_TS_FILES,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          globals: true,
          include: ['src/tests/**/*.test.tsx', ...JSDOM_TS_FILES],
        },
      },
    ],
  },
});
