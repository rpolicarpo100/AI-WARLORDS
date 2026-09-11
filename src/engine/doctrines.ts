/**
 * M033 — AI Doctrine vocabulary + canonical DNA deltas (LEAF L0, zero imports).
 *
 * Six doctrines (master #24, code-lowercase order): blitz, turtle,
 * economic-empire, guerrilla, siege-master, counterstrike. Each maps to
 * canonical DNA deltas — the 6×10 matrix VOTED 2026-09-11 (neutral 0;
 * posture-primary ±25–30; multiples of 5; clamped ±30). Deltas modulate
 * base DNA additively for future consumers (voted composition, recorded
 * here and executed there — a composer would be L2+, out of scope):
 * effective = clamp(base + deltas, 0–100), base = record DNA ??
 * personality preset ?? 50-neutral (voted emperor). DoctrineDeltas
 * structurally mirrors DnaTraits (dna.ts canonical — L0↛L0 forbids
 * importing it); deltas are NOT valid DNA (negatives legal) so no
 * isDnaTraits conformance applies — bounds are pinned instead.
 * Forward-placed (M014→M015 precedent): no writer, no behavior.
 */

export const DOCTRINE_IDS: readonly string[] = Object.freeze([
  'blitz',
  'turtle',
  'economic-empire',
  'guerrilla',
  'siege-master',
  'counterstrike',
]);

export type DoctrineId =
  'blitz' | 'turtle' | 'economic-empire' | 'guerrilla' | 'siege-master' | 'counterstrike';

/** Structural mirror of DnaTraits (dna.ts). L0↛L0: deliberately not imported. */
export interface DoctrineDeltas {
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

export const DELTA_MIN = -30;
export const DELTA_MAX = 30;

export function isDoctrineId(value: unknown): value is DoctrineId {
  return typeof value === 'string' && (DOCTRINE_IDS as readonly string[]).includes(value);
}

/**
 * Canonical DNA deltas (voted matrix 2026-09-11). Frozen.
 * Trait order: aggression, defense, economy, exploration, risk,
 * expansion, diplomacy, patience, greed, adaptability.
 */
export const DOCTRINE_DNA_DELTAS: Readonly<Record<DoctrineId, DoctrineDeltas>> = Object.freeze({
  blitz: Object.freeze({
    aggression: 25,
    defense: -15,
    economy: -10,
    exploration: 10,
    risk: 25,
    expansion: 15,
    diplomacy: -10,
    patience: -20,
    greed: 10,
    adaptability: 10,
  }),
  turtle: Object.freeze({
    aggression: -20,
    defense: 30,
    economy: 10,
    exploration: -15,
    risk: -20,
    expansion: -10,
    diplomacy: 0,
    patience: 25,
    greed: 0,
    adaptability: -10,
  }),
  'economic-empire': Object.freeze({
    aggression: -10,
    defense: 10,
    economy: 30,
    exploration: 10,
    risk: -10,
    expansion: 20,
    diplomacy: 15,
    patience: 20,
    greed: 20,
    adaptability: 0,
  }),
  guerrilla: Object.freeze({
    aggression: 15,
    defense: -10,
    economy: 0,
    exploration: 25,
    risk: 20,
    expansion: 10,
    diplomacy: 0,
    patience: 10,
    greed: 10,
    adaptability: 25,
  }),
  'siege-master': Object.freeze({
    aggression: 10,
    defense: 15,
    economy: 15,
    exploration: -5,
    risk: 0,
    expansion: 5,
    diplomacy: -10,
    patience: 30,
    greed: 10,
    adaptability: 0,
  }),
  counterstrike: Object.freeze({
    aggression: 10,
    defense: 25,
    economy: 0,
    exploration: 0,
    risk: 5,
    expansion: 0,
    diplomacy: 0,
    patience: 20,
    greed: 0,
    adaptability: 15,
  }),
});

/**
 * Canonical deltas as a FRESH copy — or undefined for unknown ids
 * (fail-soft lookup, commanderById precedent).
 */
export function dnaDeltasOf(doctrine: DoctrineId): DoctrineDeltas | undefined {
  const deltas: DoctrineDeltas | undefined = DOCTRINE_DNA_DELTAS[doctrine];
  if (deltas === undefined) {
    return undefined;
  }
  return { ...deltas };
}
