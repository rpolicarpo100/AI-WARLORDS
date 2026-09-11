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
 * M031 embeds optional DNA (DnaTraits mirror — dna.ts canonical, L0↛L0).
 * M032 embeds optional personality label (union mirror — personalities.ts
 * canonical, L0↛L0). Presets are NOT mirrored (lookup lives in
 * personalities.ts; the record carries only the label).
 */

export const COMMANDERS_SCHEMA_VERSION = 1;

/** M031 mirror of DnaTraits (dna.ts canonical; L0↛L0: deliberately not imported). */
export interface CommanderDna {
  readonly aggression: number;
  readonly defense: number;
  readonly economy: number;
  readonly exploration: number;
  readonly risk: number;
  readonly expansion: number;
  readonly diplomacy: number;
  readonly patience: number;
  readonly greed: number;
  readonly adaptability: number;
}

/** M032 mirror of PersonalityId (personalities.ts canonical; L0↛L0: deliberately not imported). */
export type CommanderPersonality =
  'conqueror' | 'strategist' | 'defender' | 'manipulator' | 'emperor';

export interface CommanderRecord {
  readonly id: string;
  readonly owner: string;
  readonly active: boolean;
  readonly dna?: CommanderDna;
  readonly personality?: CommanderPersonality;
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

/** Mirrors TRAIT_IDS (dna.ts). Leaf: deliberately not imported. */
const MIRRORED_TRAIT_IDS: readonly string[] = [
  'aggression',
  'defense',
  'economy',
  'exploration',
  'risk',
  'expansion',
  'diplomacy',
  'patience',
  'greed',
  'adaptability',
];

/** Mirrors DNA_MIN / DNA_MAX (dna.ts). Leaf: deliberately not imported. */
const MIRRORED_DNA_MIN = 0;
const MIRRORED_DNA_MAX = 100;

function isMirroredTraitValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIRRORED_DNA_MIN &&
    value <= MIRRORED_DNA_MAX
  );
}

/** Mirrors PERSONALITY_IDS (personalities.ts). Leaf: deliberately not imported. */
const MIRRORED_PERSONALITY_IDS: readonly string[] = [
  'conqueror',
  'strategist',
  'defender',
  'manipulator',
  'emperor',
];

/** Mirrors isPersonalityId (personalities.ts). */
function isMirroredPersonality(value: unknown): value is CommanderPersonality {
  return typeof value === 'string' && MIRRORED_PERSONALITY_IDS.includes(value);
}

/** Mirrors isDnaTraits (dna.ts): total DNA check, extras ignored (M015). */
function isMirroredDna(value: unknown): value is CommanderDna {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  for (const trait of MIRRORED_TRAIT_IDS) {
    if (!isMirroredTraitValue(fields[trait])) {
      return false;
    }
  }
  return true;
}

export function isCommanderRecord(value: unknown): value is CommanderRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isCommanderId(fields['id']) &&
    isHolderId(fields['owner']) &&
    typeof fields['active'] === 'boolean' &&
    (fields['dna'] === undefined || isMirroredDna(fields['dna'])) &&
    (fields['personality'] === undefined || isMirroredPersonality(fields['personality']))
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
    .map((commander) => copyRecord(commander));
}

/** Fresh copy incl. nested DNA (M031: spread alone would alias dna). */
function copyRecord(commander: CommanderRecord): CommanderRecord {
  if (commander.dna === undefined) {
    return { ...commander };
  }
  return { ...commander, dna: { ...commander.dna } };
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
  return copyRecord(found);
}
