/**
 * M072 production entry for the SSE+POST transport.
 *
 * Run: `node dist/server/serve.js` (after `npm run build`; Render runs
 * exactly this). Reads PORT (default 3000), binds the transport and
 * prints its URL. Excluded from the coverage metric (see
 * vitest.config.ts) and validated instead by real child-process
 * execution tests (see "bootstrap" in serve.test.ts). Documented
 * exclusion with compensating control — not a way to obtain PASS.
 * (M072, src/dev.ts precedent.)
 */
import { createServer } from 'node:http';
import { createTransport } from './transport.js';

// Production access log (Render captures stdout; quiet anywhere else).
process.env['AW_LOG'] ??= '1';

const raw = process.env['PORT'] ?? '3000';
const port = Number(raw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[ai-warlords] Invalid PORT: ${JSON.stringify(raw)}`);
  process.exitCode = 1;
} else {
  const server = createServer(createTransport());
  server.listen(port, () => {
    const address = server.address();
    const url =
      typeof address === 'object' && address !== null
        ? `http://127.0.0.1:${String(address.port)}`
        : `http://127.0.0.1:${String(port)}`;
    console.log(`[ai-warlords] transport listening on ${url}`);
  });
}
