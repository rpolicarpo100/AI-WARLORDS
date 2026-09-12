/**
 * M057 — Commander proposal data (LEAF L0, zero imports).
 *
 * Player ↔ Commander foundation, commander-to-player half (data-first,
 * M055 mold): proposals are standing commander suggestions awaiting
 * player verdict. Kinds mirror the actionable vocabularies: `order`
 * suggests an order (approve → queued, M058 defines), `stance` and
 * `autonomy` ask the player to set that directive (symmetric with
 * M055). Payloads are per-kind REQUIRED (the kind selects which
 * payload M058 reads; sibling payloads ignored, M015). Payload-only:
 * no free-text notes (the game runs without LLM; templated notes
 * are future). One pending proposal per commander (single slot,
 * refutation mold). Zero transitions, zero readers until M058.
 */

export const PROPOSAL_KINDS = ['autonomy', 'order', 'stance'] as const;

/** Closed proposal vocabulary (PROPOSAL_KINDS canonical). */
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** Mirrors ORDER_IDS (orders.js). Leaf: deliberately not imported. */
const ORDERABLE_KINDS: readonly string[] = [
  'city.build',
  'economy.gather',
  'unit.attack',
  'unit.move',
  'unit.train',
];

/** M057 mirror of OrderKind (orders.ts canonical; L0↛L0: deliberately not imported). */
export type ProposalOrderKind =
  'city.build' | 'economy.gather' | 'unit.attack' | 'unit.move' | 'unit.train';

/** Mirrors AUTONOMY_LEVELS (directives.js). Leaf: deliberately not imported. */
const PROPOSAL_AUTONOMIES: readonly string[] = ['manual', 'assisted', 'autonomous'];

/** M057 mirror of AutonomyLevel (directives.ts canonical; L0↛L0: deliberately not imported). */
export type ProposalAutonomy = 'manual' | 'assisted' | 'autonomous';

/** Mirrors STANCE_IDS (stance.js). Leaf: deliberately not imported (stance sits at L2). */
const PROPOSAL_STANCES: readonly string[] = [
  'aggressive',
  'defensive',
  'expansionist',
  'diplomatic',
  'balanced',
];

/** M057 mirror of Stance (stance.ts canonical; L0↛L2: deliberately not imported). */
export type ProposalStance =
  'aggressive' | 'defensive' | 'expansionist' | 'diplomatic' | 'balanced';

/** Mirrors MAX_ORDER_PARAMS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDER_PARAMS = 8;

/** Mirrors MAX_ORDER_PARAM_KEY_CHARS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDER_PARAM_KEY_CHARS = 32;

/** Mirrors MAX_ORDER_PARAM_CHARS (orders.ts). Leaf: deliberately not imported. */
const MIRRORED_MAX_ORDER_PARAM_CHARS = 64;

/** M057 mirror of CommanderOrder (orders.ts canonical; L0↛L0: deliberately not imported). */
export interface ProposalOrder {
  readonly kind: ProposalOrderKind;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

/** One pending suggestion: kind selects the payload M058 reads. */
export interface CommanderProposal {
  readonly kind: ProposalKind;
  readonly order?: ProposalOrder;
  readonly stance?: ProposalStance;
  readonly autonomy?: ProposalAutonomy;
}

export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(value);
}

function isProposalOrderKind(value: unknown): value is ProposalOrderKind {
  return typeof value === 'string' && ORDERABLE_KINDS.includes(value);
}

function isProposalParamKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MIRRORED_MAX_ORDER_PARAM_KEY_CHARS
  );
}

function isProposalParamValue(value: unknown): value is string | number | boolean {
  if (typeof value === 'string') {
    return value.length <= MIRRORED_MAX_ORDER_PARAM_CHARS;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  return typeof value === 'boolean';
}

function isProposalOrderParams(value: unknown): value is ProposalOrder['params'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > MIRRORED_MAX_ORDER_PARAMS) {
    return false;
  }
  for (const [key, entry] of entries) {
    if (!isProposalParamKey(key) || !isProposalParamValue(entry)) {
      return false;
    }
  }
  return true;
}

function isProposalOrder(value: unknown): value is ProposalOrder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  return (
    isProposalOrderKind(fields['kind']) &&
    (fields['params'] === undefined || isProposalOrderParams(fields['params']))
  );
}

/** Total proposal check: kind whitelisted, its payload valid, extras ignored (M015). */
export function isCommanderProposal(value: unknown): value is CommanderProposal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  const kind = fields['kind'];
  if (!isProposalKind(kind)) {
    return false;
  }
  if (kind === 'order') {
    return isProposalOrder(fields['order']);
  }
  if (kind === 'stance') {
    const stance = fields['stance'];
    return typeof stance === 'string' && PROPOSAL_STANCES.includes(stance);
  }
  const autonomy = fields['autonomy'];
  return typeof autonomy === 'string' && PROPOSAL_AUTONOMIES.includes(autonomy);
}
