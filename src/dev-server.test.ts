import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { formatDevUrl, handleDevRequest, parseDevConfig, runDev } from './dev-server.js';

interface HealthBody {
  readonly status: string;
  readonly service: string;
  readonly version: string;
  readonly timestamp: string;
}

async function readJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(url, init);
  const body: unknown = await res.json();
  return { status: res.status, body, headers: res.headers };
}

/** Starts a real server on an ephemeral port, runs fn, then closes it. */
async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const handle = await runDev({ PORT: '0', HOST: '127.0.0.1' });
  try {
    await fn(handle.url);
  } finally {
    await handle.close();
  }
}

describe('parseDevConfig (unit)', () => {
  it('defaults to 127.0.0.1:3000 when env is empty', () => {
    expect(parseDevConfig({})).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it('treats a blank PORT as missing', () => {
    expect(parseDevConfig({ PORT: '' })).toEqual({ host: '127.0.0.1', port: 3000 });
    expect(parseDevConfig({ PORT: '   ' })).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it('accepts explicit HOST/PORT, including ephemeral port 0', () => {
    expect(parseDevConfig({ HOST: '0.0.0.0', PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
    expect(parseDevConfig({ PORT: '0' })).toEqual({ host: '127.0.0.1', port: 0 });
  });

  it.each(['abc', '12.5', '-1', '65536', '9999999999999999999999'])(
    'throws a clear error for invalid PORT %j',
    (port) => {
      expect(() => parseDevConfig({ PORT: port })).toThrow(/Invalid PORT/);
    },
  );
});

describe('formatDevUrl (unit)', () => {
  it('throws for unix-socket and null addresses', () => {
    expect(() => formatDevUrl('127.0.0.1', null)).toThrow(/TCP address/);
    expect(() => formatDevUrl('127.0.0.1', '\\\\.\\pipe\\ai-warlords')).toThrow(/TCP address/);
  });

  it('formats a TCP address into a reachable URL', () => {
    expect(formatDevUrl('127.0.0.1', { address: '127.0.0.1', family: 'IPv4', port: 4321 })).toBe(
      'http://127.0.0.1:4321',
    );
  });
});

describe('runDev + HTTP (integration, real sockets)', () => {
  it('serves GET /health with 200, JSON content-type and no reflection surface', async () => {
    await withServer(async (url) => {
      const { status, body, headers } = await readJson(`${url}/health`);

      expect(status).toBe(200);
      expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(headers.get('x-powered-by')).toBeNull();

      const health = body as HealthBody;
      expect(health.status).toBe('ok');
      expect(health.service).toBe('ai-warlords-dev');
      expect(health.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
    });
  });

  it('ignores the query string on /health', async () => {
    await withServer(async (url) => {
      const { status } = await readJson(`${url}/health?verbose=true`);
      expect(status).toBe(200);
    });
  });

  it('answers 404 with a static body for unknown paths and wrong methods', async () => {
    await withServer(async (url) => {
      const notFound = await readJson(`${url}/unknown`);
      expect(notFound.status).toBe(404);
      expect(notFound.body).toEqual({ error: 'not_found' });

      const wrongMethod = await readJson(`${url}/health`, { method: 'POST' });
      expect(wrongMethod.status).toBe(404);
      expect(wrongMethod.body).toEqual({ error: 'not_found' });
    });
  });

  it('never reflects request input in error bodies (security)', async () => {
    await withServer(async (url) => {
      const { status, body } = await readJson(`${url}/%3Cscript%3Ealert(1)%3C/script%3E`);
      expect(status).toBe(404);
      expect(body).toEqual({ error: 'not_found' });
      expect(JSON.stringify(body)).not.toContain('script');
    });
  });

  it('answers 400 for a non origin-form request target (failure)', async () => {
    await withServer(async (url) => {
      const port = Number(new URL(url).port);
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path: 'http://evil.example/', method: 'GET' },
          (res) => {
            res.resume();
            res.on('end', () => {
              resolve(res.statusCode ?? 0);
            });
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(statusCode).toBe(400);
    });
  });

  it('handles 50 concurrent requests (adversarial: concurrency)', async () => {
    await withServer(async (url) => {
      const results = await Promise.all(
        Array.from({ length: 50 }, () => readJson(`${url}/health`)),
      );
      for (const { status, body } of results) {
        expect(status).toBe(200);
        expect((body as HealthBody).status).toBe('ok');
      }
    });
  });

  it('survives garbage bytes and keeps serving (adversarial: malformed input)', async () => {
    const handle = await runDev({ PORT: '0', HOST: '127.0.0.1' });
    try {
      const port = Number(new URL(handle.url).port);
      const rawResponse = await new Promise<string>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => {
          socket.write('THIS IS NOT HTTP\r\n\r\n');
        });
        let response = '';
        // The socket must consume the server's reply: a paused socket with
        // unread buffered data never emits 'end'/'close' (test bug found in
        // review — the server answered 400 correctly all along).
        socket.on('data', (chunk: Buffer) => {
          response += chunk.toString('utf8');
        });
        socket.on('error', reject);
        socket.on('close', () => {
          resolve(response);
        });
      });
      expect(rawResponse).toContain('400 Bad Request');

      const { status } = await readJson(`${handle.url}/health`);
      expect(status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('rejects (never hangs) when the port is already bound (adversarial: EADDRINUSE)', async () => {
    const first = await runDev({ PORT: '0', HOST: '127.0.0.1' });
    try {
      const port = new URL(first.url).port;
      await expect(runDev({ PORT: port, HOST: '127.0.0.1' })).rejects.toThrow(/EADDRINUSE/);

      const { status } = await readJson(`${first.url}/health`);
      expect(status).toBe(200);
    } finally {
      await first.close();
    }
  });

  it('propagates close errors instead of swallowing them (failure: double close)', async () => {
    const handle = await runDev({ PORT: '0', HOST: '127.0.0.1' });
    await handle.close();
    await expect(handle.close()).rejects.toThrow(/not running/);
  });

  it('throws synchronously for invalid env (failure)', () => {
    expect(() => runDev({ PORT: 'not-a-port' })).toThrow(/Invalid PORT/);
  });
});

describe('handleDevRequest defensive branch (TEST MOCK unit test)', () => {
  it('treats a missing req.url as "/" and never crashes', () => {
    // TEST MOCK — synthetic req/res objects: covers the defensive branch for
    // `req.url === undefined`, which is unreachable via real HTTP/1.x traffic
    // (Node always sets `url` for parsed requests; unparsable bytes trigger
    // the `clientError` path instead). All behaviour paths above are tested
    // through real sockets.
    const req = { url: undefined, method: 'GET' } as unknown as IncomingMessage;
    let statusCode = 0;
    let payload = '';
    const res = {
      writeHead: (code: number): void => {
        statusCode = code;
      },
      end: (chunk: string): void => {
        payload = chunk;
      },
    } as unknown as ServerResponse;

    handleDevRequest(req, res);

    expect(statusCode).toBe(404);
    expect(JSON.parse(payload) as unknown).toEqual({ error: 'not_found' });
  });
});

describe('bootstrap (real child process: tsx src/dev.ts)', () => {
  function spawnDev(extraEnv: Record<string, string>): ChildProcess {
    return spawn('npx', ['--no-install', 'tsx', 'src/dev.ts'], {
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
        const match = /listening on (http:\/\/\S+)/.exec(output);
        const url = match?.[1];
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

  it('boots, prints its URL and serves /health, then shuts down on SIGTERM', async () => {
    const child = spawnDev({ HOST: '127.0.0.1', PORT: '0' });
    try {
      const url = await waitForUrl(child, 20000);
      const { status, body } = await readJson(`${url}/health`);
      expect(status).toBe(200);
      expect((body as HealthBody).status).toBe('ok');
    } finally {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }, 25000);

  it('exits 1 with a clear error on invalid PORT', async () => {
    const child = spawnDev({ PORT: 'not-a-port' });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const [code] = (await once(child, 'exit')) as [number | null];
    expect(code).toBe(1);
    expect(stderr).toMatch(/Invalid PORT/);
  }, 25000);
});
