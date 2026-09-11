/**
 * M027 — Commander data + guard + queries (LEAF L0, zero imports).
 *
 * Commander roster (AI Foundation core): each record carries id/owner/active.
 * Commander state, doctrine, and personality belong to their owning modules
 * (M029/M031+); `active` is stored here and read there (M014→M015
 * forward-storage precedent). Init-placed until a lifecycle owner exists
 * (M018→M019 precedent). The guard lives here because WorldState (L1) may
 * only import downward (M009 layering law, M014 forcing). Holder ids and
 * the uint32 ceiling mirror stockpiles.js / rng.js (L0↛L0: deliberately
 * not imported); the test cross-checks the mirrors (divergence fails loud).
 */

export const COMMANDERS_SCHEMA_VERSION = 1;

export interface CommanderRecord {
  readonly id: string;
  readonly owner: string;
  readonly active: boolean;
}

export interface CommandersData {
  readonly schemaVersion: typeof COMMANDERS_SCHEMA_VERSION;
  readonly nextId: number;
  readonly commanders: readonly CommanderRecord[];
}

/** Mirrors MAX_HOLDER_ID_CHARS (stockpiles.js). Leaf: deliberately not imported. */
export const MAX_HOLDER_ID_CHARS = 64;

/** Commander ids share the holder bound (symmetric; own bound, not mirrored). */
export const MAX_COMMANDER_ID_CHARS = 64;

/** Mirrors MAX_UINT32 (rng.js). Leaf: deliberately not imported. */
const MAX_WORD = 0xffffffff;

function isHolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_HOLDER_ID_CHARS;
}

function isCommanderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_COMMANDER_ID_CHARS;
}

function isWord(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_WORD;
}

export function isCommanderRecord(value: unknown): value is CommanderRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isCommanderId(fields['id']) &&
    isHolderId(fields['owner']) &&
    typeof fields['active'] === 'boolean'
  );
}

export function isCommandersData(value: unknown): value is CommandersData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== COMMANDERS_SCHEMA_VERSION) {
    return false;
  }
  if (!isWord(fields['nextId'])) {
    return false;
  }
  const commanders = fields['commanders'];
  if (!Array.isArray(commanders)) {
    return false;
  }
  const seen = new Set<string>();
  for (const commander of commanders) {
    if (!isCommanderRecord(commander)) {
      return false;
    }
    if (seen.has(commander.id)) {
      return false;
    }
    seen.add(commander.id);
  }
  return true;
}

/**
 * Holder's commanders as FRESH copies in array order — or [] for unknown
 * holders and absent data (fail-soft). Pure L0 builder (map.js loader
 * precedent): callers freeze the result into their own trees.
 */
export function commandersOf(
  data: CommandersData | undefined,
  holder: string,
): CommanderRecord[] {
  if (data === undefined) {
    return [];
  }
  return data.commanders
    .filter((commander) => commander.owner === holder)
    .map((commander) => ({ ...commander }));
}

/**
 * Record lookup as a FRESH copy — or undefined when absent (fail-soft).
 * Ids are unique per the guard, so the first match is the only match.
 */
export function commanderById(
  data: CommandersData | undefined,
  id: string,
): CommanderRecord | undefined {
  const found = data?.commanders.find((commander) => commander.id === id);
  if (found === undefined) {
    return undefined;
  }
  return { ...found };
}
