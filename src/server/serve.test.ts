/**
 * M072 — serve entry tests: REAL child processes (`tsx src/server/serve.ts`,
 * src/dev-server.test.ts bootstrap precedent — no mocks). Boots, prints its
 * URL, serves / and forges matches over the wire, dies clean on SIGTERM;
 * invalid PORT exits 1 loud.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

function spawnServe(extraEnv: Record<string, string>): ChildProcess {
  return spawn('npx', ['--no-install', 'tsx', 'src/server/serve.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
  let output = '';
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for listen URL; got: ${output}`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const found = /listening on (http:\/\/\S+)/.exec(output);
      const url = found?.[1];
      if (url !== undefined) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited (${String(code)}) before printing URL; got: ${output}`));
    });
  });
}

describe('bootstrap (real child process: tsx src/server/serve.ts)', () => {
  it('boots, serves / and forges a match, then shuts down on SIGTERM', async () => {
    const child = spawnServe({ PORT: '0' });
    try {
      const url = await waitForUrl(child, 20000);
      const health = await fetch(`${url}/`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ service: 'ai-warlords', ok: true });
      const forged = await fetch(`${url}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(forged.status).toBe(200);
      expect(typeof ((await forged.json()) as { matchId: string }).matchId).toBe('string');
    } finally {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }, 25000);

  it('exits 1 with a clear error on invalid PORT', async () => {
    const child = spawnServe({ PORT: 'not-a-port' });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const [code] = (await once(child, 'exit')) as [number | null];
    expect(code).toBe(1);
    expect(stderr).toMatch(/Invalid PORT/);
  }, 25000);
});
