import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The version is read from the real package.json (repo root) so it can
// never drift from the released version. Works both from src/ (tsx/vitest)
// and from dist/ (compiled output), since both sit one level below root.
const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

export interface HealthStatus {
  readonly status: 'ok';
  readonly service: 'ai-warlords-dev';
  readonly version: string;
  readonly timestamp: string;
}

/**
 * Returns the dev-server health payload.
 *
 * @param now Injectable clock. Defaults to the current time; tests inject a
 * fixed date to assert determinism (a preview of the M005 requirement).
 */
export function getHealth(now: Date = new Date()): HealthStatus {
  return {
    status: 'ok',
    service: 'ai-warlords-dev',
    version: packageJson.version,
    timestamp: now.toISOString(),
  };
}
