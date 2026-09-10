import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  readonly type: string;
  readonly private: boolean;
  readonly engines: { readonly node: string };
  readonly scripts: Record<string, string>;
  readonly dependencies?: Record<string, string>;
}

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;

// Regression guard for the M002 deliverable itself: the environment contract.
// If a future change breaks the gate scripts, the ESM setup or the
// zero-production-dependency policy, this suite fails first.
describe('environment contract (M002 gate regression guard)', () => {
  it('declares ESM, private and a Node 20+ engine floor', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.private).toBe(true);
    expect(pkg.engines.node).toMatch(/20/);

    const major = Number((process.versions.node.split('.')[0] ?? '').trim());
    expect(Number.isInteger(major)).toBe(true);
    expect(major).toBeGreaterThanOrEqual(20);
  });

  it('declares every gate script', () => {
    for (const script of ['build', 'start', 'dev', 'test', 'lint', 'format', 'typecheck']) {
      expect(pkg.scripts[script], `missing script: ${script}`).toBeTruthy();
    }
  });

  it('keeps zero production dependencies', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
