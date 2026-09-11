/**
 * M031 — AI DNA vocabulary + guard (LEAF L0, zero imports).
 *
 * Ten independent trait axes (master #22, code-lowercase order):
 * aggression, defense, economy, exploration, risk, expansion,
 * diplomacy, patience, greed, adaptability — each an integer
 * 0–100 (voted; no fixed sum — no master anchor). DNA influences
 * decisions but never fully determines behavior (#22); it is
 * orthogonal to skill (#25 PERSONALITY≠SKILL — noted for future
 * consumers). Forward-placed canonical vocabulary (M014→M015
 * precedent): embedded optionally in CommanderRecord (whose guard
 * mirrors this file — L0↛L0 forbids importing it) and consumed
 * by personality modules (M032+). No writer exists yet
 * (init-placed until one does — M027 precedent).
 */

export const DNA_MIN = 0;
export const DNA_MAX = 100;

/** Canonical trait ids, master #22 order (lowercase, terrain-ids mold). */
export const TRAIT_IDS: readonly string[] = Object.freeze([
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
]);

export type DnaTraitId =
  | 'aggression'
  | 'defense'
  | 'economy'
  | 'exploration'
  | 'risk'
  | 'expansion'
  | 'diplomacy'
  | 'patience'
  | 'greed'
  | 'adaptability';

export interface DnaTraits {
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

export function isDnaTraitId(value: unknown): value is DnaTraitId {
  return typeof value === 'string' && (TRAIT_IDS as readonly string[]).includes(value);
}

function isTraitValue(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= DNA_MIN && value <= DNA_MAX
  );
}

/**
 * Total DNA guard: a plain object carrying all ten traits in range.
 * Extra keys are ignored (M015 legacy-leniency doctrine).
 */
export function isDnaTraits(value: unknown): value is DnaTraits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  for (const trait of TRAIT_IDS) {
    if (!isTraitValue(fields[trait])) {
      return false;
    }
  }
  return true;
}
