/**
 * PROMPTS — Prompt-budget data + guard + queries (LEAF L0, zero imports).
 *
 * Per-holder remaining prompt counts (D-022: ticks die; every applied
 * dispatch spends one of the caller's prompts, rejected dispatches are
 * free). Absent holders read 0 (fail-closed: no entry = blocked). The
 * guard lives here because WorldState (L1) may only import downward
 * (M009 layering law, M014 forcing). Holder ids and the uint32 ceiling
 * mirror stockpiles.js / rng.js (L0↛L0: deliberately not imported);
 * the test cross-checks the mirrors (divergence fails loud).
 */

export const PROMPTS_SCHEMA_VERSION = 1;

export interface PromptsData {
  readonly schemaVersion: typeof PROMPTS_SCHEMA_VERSION;
  readonly remaining: { readonly [holder: string]: number };
}

/** Mirrors MAX_HOLDER_ID_CHARS (stockpiles.js). Leaf: deliberately not imported. */
export const MAX_HOLDER_ID_CHARS = 64;

/** Mirrors MAX_UINT32 (rng.js). Leaf: deliberately not imported. */
const MAX_WORD = 0xffffffff;

function isHolderId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_HOLDER_ID_CHARS;
}

function isWord(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_WORD;
}

export function isPromptsData(value: unknown): value is PromptsData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  if (fields['schemaVersion'] !== PROMPTS_SCHEMA_VERSION) {
    return false;
  }
  const remaining = fields['remaining'];
  if (typeof remaining !== 'object' || remaining === null || Array.isArray(remaining)) {
    return false;
  }
  for (const [holder, count] of Object.entries(remaining)) {
    if (!isHolderId(holder) || !isWord(count)) {
      return false;
    }
  }
  return true;
}

/**
 * Holder's remaining prompts — or 0 for unknown holders and absent data
 * (fail-soft reads blocked; the ledger post-rule counts exact totals).
 */
export function promptsOf(data: PromptsData | undefined, holder: string): number {
  return data?.remaining[holder] ?? 0;
}

/**
 * Seed every holder with the per-player budget (Match construction).
 * Loud on bad input (programmer error, never caller input).
 */
export function seedPrompts(holders: readonly string[], perPlayer: number): PromptsData {
  if (!Array.isArray(holders) || holders.length === 0) {
    throw new Error('seedPrompts: invalid holders.');
  }
  for (const holder of holders) {
    if (!isHolderId(holder)) {
      throw new Error('seedPrompts: invalid holders.');
    }
  }
  if (!isWord(perPlayer) || perPlayer < 1) {
    throw new Error('seedPrompts: invalid budget (expected positive uint32).');
  }
  const remaining: Record<string, number> = {};
  for (const holder of holders) {
    remaining[holder] = perPlayer;
  }
  return { schemaVersion: PROMPTS_SCHEMA_VERSION, remaining };
}

/**
 * Spend one prompt (pure; Match post-step). Throws when the slot is
 * absent or the holder is dry (the wrapper pre-checks, so a throw is
 * a programmer error — spawnUnit precedent).
 */
export function spendPrompt(data: PromptsData | undefined, holder: string): PromptsData {
  if (data === undefined) {
    throw new Error('spendPrompt: no prompts data.');
  }
  const left = data.remaining[holder] ?? 0;
  if (left <= 0) {
    throw new Error('spendPrompt: no prompts left.');
  }
  return {
    schemaVersion: data.schemaVersion,
    remaining: { ...data.remaining, [holder]: left - 1 },
  };
}
