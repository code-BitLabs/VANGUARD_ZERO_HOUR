export interface DevModeEnvLike {
  VITE_DEV_MODE?: string | boolean;
  DEV?: boolean;
  PROD?: boolean;
}

let testEnvOverride: DevModeEnvLike | null = null;

function parseEnvBoolean(value: string | boolean | undefined): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const norm = value.trim().toLowerCase();
  if (norm === '') return null;
  if (norm === 'false' || norm === '0' || norm === 'off' || norm === 'no') return false;
  if (norm === 'true' || norm === '1' || norm === 'on' || norm === 'yes') return true;
  return null;
}

/**
 * Resolves whether the current build/environment allows Developer Tools ([F4], [F3], gizmos, sandbox).
 * Priority:
 *  1. Explicit VITE_DEV_MODE env flag ("false" always disables even in dev; "true" enables).
 *  2. Fallback to Vite build mode: enabled when DEV && !PROD, disabled on production release builds.
 */
export function resolveEnvDevModeAllowed(env?: DevModeEnvLike): boolean {
  const source: DevModeEnvLike =
    env ??
    testEnvOverride ??
    ((import.meta as unknown as { env?: DevModeEnvLike }).env ?? { DEV: false, PROD: true });

  const explicit = parseEnvBoolean(source.VITE_DEV_MODE);
  if (explicit !== null) {
    return explicit;
  }

  return Boolean(source.DEV) && !Boolean(source.PROD);
}

export function isEnvDevModeAllowed(): boolean {
  return resolveEnvDevModeAllowed();
}

export function isDeveloperModeActiveForSetting(
  devModeEnabledSetting: boolean,
  env?: DevModeEnvLike
): boolean {
  return resolveEnvDevModeAllowed(env) && Boolean(devModeEnabledSetting);
}

export function setDevModeEnvOverrideForTests(env: DevModeEnvLike | null): void {
  testEnvOverride = env;
}
