/**
 * M055 — Commander directive data (LEAF L0, zero imports).
 *
 * Player ↔ Commander foundation, player-to-commander half (data-first,
 * M046/M051 mold): directives are standing player instructions beyond
 * the order queue. `autonomy` names who decides (manual = the status
 * quo, player-issued orders only; assisted/autonomous = the AI may
 * suggest/act — mechanics M056+). `stance` names a player-ordered
 * posture override (precedence over DNA + recall M056+ defines).
 * Directives are STATE, not history: a per-kind set (setting
 * overwrites; absent means unset). Zero transitions, zero readers
 * until M056+.
 */

export const DIRECTIVE_KINDS = ['autonomy', 'stance'] as const;

/** Closed directive vocabulary (DIRECTIVE_KINDS canonical). */
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

export const AUTONOMY_LEVELS = ['manual', 'assisted', 'autonomous'] as const;

/** Closed autonomy vocabulary (AUTONOMY_LEVELS canonical). */
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Mirrors STANCE_IDS (stance.js). Leaf: deliberately not imported (stance sits at L2). */
const DIRECTIVE_STANCES: readonly string[] = [
  'aggressive',
  'defensive',
  'expansionist',
  'diplomatic',
  'balanced',
];

/** M055 mirror of Stance (stance.ts canonical; L0↛L2: deliberately not imported). */
export type DirectiveStance =
  'aggressive' | 'defensive' | 'expansionist' | 'diplomatic' | 'balanced';

/** Standing player instructions: one value per kind, absent means unset. */
export interface CommanderDirectives {
  readonly autonomy?: AutonomyLevel;
  readonly stance?: DirectiveStance;
}

export function isDirectiveKind(value: unknown): value is DirectiveKind {
  return typeof value === 'string' && (DIRECTIVE_KINDS as readonly string[]).includes(value);
}

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === 'string' && (AUTONOMY_LEVELS as readonly string[]).includes(value);
}

function isDirectiveStance(value: unknown): value is DirectiveStance {
  return typeof value === 'string' && DIRECTIVE_STANCES.includes(value);
}

/** Total directives check: per-kind values valid, extras ignored (M015). */
export function isCommanderDirectives(value: unknown): value is CommanderDirectives {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  const autonomy = fields['autonomy'];
  const stance = fields['stance'];
  return (
    (autonomy === undefined || isAutonomyLevel(autonomy)) &&
    (stance === undefined || isDirectiveStance(stance))
  );
}
