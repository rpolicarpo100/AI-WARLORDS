import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getHealth } from './health.js';

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

describe('getHealth (unit)', () => {
  it('returns ok status with the service name and the real package version', () => {
    const before = Date.now();
    const health = getHealth();
    const after = Date.now();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('ai-warlords-dev');
    expect(health.version).toBe(packageJson.version);
    expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);

    const timestamp = Date.parse(health.timestamp);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('is deterministic for an injected clock', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');

    expect(getHealth(fixed).timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(getHealth(fixed)).toEqual(getHealth(fixed));
  });
});
