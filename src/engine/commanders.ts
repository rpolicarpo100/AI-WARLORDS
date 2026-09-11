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
 * M033 embeds optional doctrine label (union mirror — doctrines.ts
 * canonical, L0↛L0; deltas NOT mirrored, same rationale).
 * M043 embeds an optional standing order (shape mirror — orders.ts
 * canonical, L0↛L0; per-kind semantics NOT mirrored, M044 owns).
 * M044 amends storage to an optional FIFO queue (`orders?`, absent
 * means empty, capped — orders.ts canonical, same L0↛L0 law). A
 * stale M043 `order` key is ignored, never rejected (back-compat).
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

/** M033 mirror of DoctrineId (doctrines.ts canonical; L0↛L0: deliberately not imported). */
export type CommanderDoctrine =
  'blitz' | 'turtle' | 'economic-empire' | 'guerrilla' | 'siege-master' | 'counterstrike';

/** M043 mirror of OrderKind (orders.ts canonical; L0↛L0: deliberately not imported). */
export type CommanderOrderKind =
  'city.build' | 'economy.gather' | 'unit.attack' | 'unit.move' | 'unit.train';

/** M043 mirror of OrderParams (flat scalar record; orders.ts canonical, L0↛L0). */
export interface CommanderOrderParams {
  readonly [key: string]: string | number | boolean;
}

/** M043 mirror of CommanderOrder (orders.ts canonical; L0↛L0: deliberately not imported). */
export interface CommanderOrder {
  readonly kind: CommanderOrderKind;
  readonly params?: CommanderOrderParams;
}

/** M044 FIFO queue of standing orders (absent means empty; capped). */
export type CommanderOrders = readonly CommanderOrder[];

export interface CommanderRecord {
  readonly id: string;
  readonly owner: string;
  readonly active: boolean;
  readonly dna?: CommanderDna;
  readonly personality?: CommanderPersonality;
  readonly doctrine?: CommanderDoctrine;
  readonly orders?: CommanderOrders;
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

/** Mirrors DOCTRINE_IDS (doctrines.ts). Leaf: deliberately not imported. */
const MIRRORED_DOCTRINE_IDS: readonly string[] = [
  'blitz',
  'turtle',
  'economic-empire',
  'guerrilla',
  'siege-master',
  'counterstrike',
];

/** Mirrors isDoctrineId (doctrines.ts). */
function isMirroredDoctrine(value: unknown): value is CommanderDoctrine {
  return typeof value === 'string' && MIRRORED_DOCTRINE_IDS.includes(value);
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

/** Mirrors ORDER_IDS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_ORDER_IDS: readonly string[] = [
  'city.build',
  'economy.gather',
  'unit.attack',
  'unit.move',
  'unit.train',
];

/** Mirrors MAX_ORDER_PARAMS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDER_PARAMS = 8;

/** Mirrors MAX_ORDER_PARAM_KEY_CHARS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDER_PARAM_KEY_CHARS = 32;

/** Mirrors MAX_ORDER_PARAM_CHARS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDER_PARAM_CHARS = 64;

/** Mirrors isOrderKind (orders.ts). */
function isMirroredOrderKind(value: unknown): value is CommanderOrderKind {
  return typeof value === 'string' && MIRRORED_ORDER_IDS.includes(value);
}

function isMirroredParamEntry(key: unknown, value: unknown): boolean {
  if (
    typeof key !== 'string' ||
    key.length < 1 ||
    key.length > MIRRORED_MAX_ORDER_PARAM_KEY_CHARS
  ) {
    return false;
  }
  if (typeof value === 'string') {
    return value.length <= MIRRORED_MAX_ORDER_PARAM_CHARS;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'boolean';
}

/** Mirrors isOrderParams (orders.ts): flat scalar record, bounded. */
function isMirroredOrderParams(value: unknown): value is CommanderOrderParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > MIRRORED_MAX_ORDER_PARAMS) {
    return false;
  }
  for (const [key, entry] of entries) {
    if (!isMirroredParamEntry(key, entry)) {
      return false;
    }
  }
  return true;
}

/** Mirrors isCommanderOrder (orders.ts): total order check, extras ignored (M015). */
function isMirroredOrder(value: unknown): value is CommanderOrder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isMirroredOrderKind(fields['kind']) &&
    (fields['params'] === undefined || isMirroredOrderParams(fields['params']))
  );
}

/** Mirrors MAX_ORDERS_PER_COMMANDER (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDERS = 8;

/** Mirrors isOrderQueue (orders.ts): capped array of valid orders. */
function isMirroredOrders(value: unknown): value is CommanderOrders {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length > MIRRORED_MAX_ORDERS) {
    return false;
  }
  for (const entry of value) {
    if (!isMirroredOrder(entry)) {
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
    (fields['personality'] === undefined || isMirroredPersonality(fields['personality'])) &&
    (fields['doctrine'] === undefined || isMirroredDoctrine(fields['doctrine'])) &&
    (fields['orders'] === undefined || isMirroredOrders(fields['orders']))
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

/** Fresh copy incl. nested DNA (M031) and queued orders (M044: spreads alias nested). */
function copyRecord(commander: CommanderRecord): CommanderRecord {
  let copy: CommanderRecord = { ...commander };
  if (commander.dna !== undefined) {
    copy = { ...copy, dna: { ...commander.dna } };
  }
  if (commander.orders !== undefined) {
    copy = { ...copy, orders: commander.orders.map((order) => copyOrder(order)) };
  }
  return copy;
}

/** Fresh order copy incl. params (flat: one spread level suffices, M031 mold). */
function copyOrder(order: CommanderOrder): CommanderOrder {
  if (order.params === undefined) {
    return { ...order };
  }
  return { ...order, params: { ...order.params } };
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
