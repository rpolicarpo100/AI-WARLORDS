/**
 * M002 dev-process bootstrap.
 *
 * Executed directly (`tsx src/dev.ts` in development, `node dist/dev.js`
 * from a build). Excluded from the coverage metric (see vitest.config.ts)
 * and validated by real child-process execution tests instead.
 */
import { runDev } from './dev-server.js';

try {
  const handle = await runDev(process.env);
  console.log(`[ai-warlords] dev server listening on ${handle.url}`);
} catch (err) {
  console.error(
    '[ai-warlords] failed to start dev server:',
    err instanceof Error ? err.message : err,
  );
  process.exitCode = 1;
}
