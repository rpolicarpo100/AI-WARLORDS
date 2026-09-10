import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getHealth } from './health.js';

export interface DevServerConfig {
  readonly host: string;
  readonly port: number;
}

export interface DevServerHandle {
  readonly server: Server;
  readonly url: string;
  readonly close: () => Promise<void>;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

/**
 * Parses dev-server config from an env mapping (pure: fully unit-testable).
 *
 * - HOST defaults to 127.0.0.1 (safe local default; override to 0.0.0.0
 *   explicitly when a LAN/preview bind is needed).
 * - PORT defaults to 3000 when missing or blank; 0 means "ephemeral port".
 * - Anything else must be an integer in [0, 65535], else it throws.
 */
export function parseDevConfig(env: NodeJS.ProcessEnv): DevServerConfig {
  const host = env.HOST ?? DEFAULT_HOST;
  const rawPort = env.PORT;
  if (rawPort === undefined || rawPort.trim() === '') {
    return { host, port: DEFAULT_PORT };
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(
      `Invalid PORT: ${JSON.stringify(rawPort)}. Expected an integer between 0 and ${String(MAX_PORT)}.`,
    );
  }
  return { host, port };
}

/**
 * Formats the reachable URL for a bound address (pure: fully unit-testable).
 * Throws loudly if the server did not bind to a TCP address.
 */
export function formatDevUrl(host: string, address: string | AddressInfo | null): string {
  if (typeof address === 'string' || address === null) {
    throw new Error('Dev server did not bind to a TCP address.');
  }
  return `http://${host}:${String(address.port)}`;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * Request router for the M002 dev scaffold.
 *
 * - `GET /health` (query string ignored) -> 200 + HealthStatus
 * - Non origin-form request target          -> 400 (never crash, never reflect)
 * - Everything else                         -> 404 `{ error: 'not_found' }`
 *
 * Error bodies are static on purpose: the server never reflects request
 * input, so there is nothing to inject into.
 */
export function handleDevRequest(req: IncomingMessage, res: ServerResponse): void {
  // Defensive: Node always sets `url` for parsed HTTP/1.x requests; the
  // fallback exists so a malformed edge can never crash the dev server.
  const rawUrl = typeof req.url === 'string' ? req.url : '/';
  if (!rawUrl.startsWith('/')) {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }
  const queryIndex = rawUrl.indexOf('?');
  const path = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, getHealth());
    return;
  }
  sendJson(res, 404, { error: 'not_found' });
}

/**
 * Starts the dev server and resolves once it is listening.
 * Rejects (never hangs, never throws synchronously past config parsing)
 * if the port cannot be bound (e.g. EADDRINUSE).
 */
export function runDev(env: NodeJS.ProcessEnv): Promise<DevServerHandle> {
  const config = parseDevConfig(env);
  const server = createServer(handleDevRequest);
  // Malformed bytes that fail HTTP parsing never reach the router; answer
  // 400 and drop only that socket — the server itself must stay up.
  server.on('clientError', (_err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return new Promise<DevServerHandle>((resolve, reject) => {
    // Kept attached for the server lifetime: before listen it rejects the
    // promise (EADDRINUSE); afterwards it swallows async errors as no-ops
    // instead of crashing the process on ERR_UNHANDLED_ERROR.
    server.on('error', reject);
    server.listen(config.port, config.host, () => {
      const url = formatDevUrl(config.host, server.address());
      resolve({
        server,
        url,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) {
                rejectClose(err);
              } else {
                resolveClose();
              }
            });
          }),
      });
    });
  });
}
