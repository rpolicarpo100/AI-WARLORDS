/**
 * M032 — AI Personality vocabulary + canonical DNA presets (LEAF L0, zero imports).
 *
 * Five personalities (master #23, code-lowercase order): conqueror,
 * strategist, defender, manipulator, emperor. The master lists them as
 * "Inicialmente" (initially): the vocabulary is fixed-5 today and grows
 * only with explicit rationale (goldens re-lock, declared). Each maps to
 * a canonical DNA preset — the 5×10 matrix VOTED 2026-09-11 (base 50
 * neutral; epithet-primary ±30–35; multiples of 5). Presets are
 * defaults, not dictates: explicit record DNA wins over the preset for
 * future consumers (voted precedence; #22 influence≠determination).
 * PersonalityDna structurally mirrors DnaTraits (dna.ts canonical —
 * L0↛L0 forbids importing it); personalities.test.ts pins every preset
 * against isDnaTraits (divergence fails loud). Orthogonal to skill
 * (#25). Forward-placed (M014→M015 precedent): no writer, no behavior.
 */

export const PERSONALITY_IDS: readonly string[] = Object.freeze([
  'conqueror',
  'strategist',
  'defender',
  'manipulator',
  'emperor',
]);

export type PersonalityId = 'conqueror' | 'strategist' | 'defender' | 'manipulator' | 'emperor';

/** Structural mirror of DnaTraits (dna.ts). L0↛L0: deliberately not imported. */
export interface PersonalityDna {
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

export function isPersonalityId(value: unknown): value is PersonalityId {
  return typeof value === 'string' && (PERSONALITY_IDS as readonly string[]).includes(value);
}

/**
 * Canonical DNA presets (voted matrix 2026-09-11). Frozen.
 * Trait order: aggression, defense, economy, exploration, risk,
 * expansion, diplomacy, patience, greed, adaptability.
 */
export const PERSONALITY_DNA_PRESETS: Readonly<Record<PersonalityId, PersonalityDna>> =
  Object.freeze({
    conqueror: Object.freeze({
      aggression: 80,
      defense: 40,
      economy: 40,
      exploration: 50,
      risk: 75,
      expansion: 70,
      diplomacy: 20,
      patience: 30,
      greed: 60,
      adaptability: 50,
    }),
    strategist: Object.freeze({
      aggression: 45,
      defense: 60,
      economy: 60,
      exploration: 55,
      risk: 35,
      expansion: 50,
      diplomacy: 50,
      patience: 80,
      greed: 40,
      adaptability: 70,
    }),
    defender: Object.freeze({
      aggression: 25,
      defense: 85,
      economy: 75,
      exploration: 30,
      risk: 20,
      expansion: 35,
      diplomacy: 55,
      patience: 85,
      greed: 45,
      adaptability: 40,
    }),
    manipulator: Object.freeze({
      aggression: 40,
      defense: 45,
      economy: 65,
      exploration: 60,
      risk: 65,
      expansion: 55,
      diplomacy: 85,
      patience: 60,
      greed: 75,
      adaptability: 80,
    }),
    emperor: Object.freeze({
      aggression: 50,
      defense: 50,
      economy: 50,
      exploration: 50,
      risk: 50,
      expansion: 50,
      diplomacy: 50,
      patience: 50,
      greed: 50,
      adaptability: 50,
    }),
  });

/**
 * Canonical preset as a FRESH copy — or undefined for unknown ids
 * (fail-soft lookup, commanderById precedent).
 */
export function dnaPresetOf(personality: PersonalityId): PersonalityDna | undefined {
  const preset: PersonalityDna | undefined = PERSONALITY_DNA_PRESETS[personality];
  if (preset === undefined) {
    return undefined;
  }
  return { ...preset };
}
