/**
 * M035 — Effective-DNA composer (LAYER L1).
 *
 * Executes the composition rule RECORDED in D-027 (voted 2026-09-11):
 * effective = clamp(base + deltas, 0–100) per trait, where base =
 * record-DNA ?? personality-preset ?? 50-neutral (emperor, voted) and
 * deltas = doctrine deltas ?? zero. Total and pure: every CommanderRecord
 * maps to valid DnaTraits (proven by the 84-combo battery). Unknown
 * labels fail soft (leaf lookup undefined = absent). Output is always
 * fresh; the input record is never mutated.
 *
 * L1 over the four L0 leaves (commanders/dna/doctrines/personalities —
 * strictly downward; the composer cannot live in a leaf, L0↛L0).
 * Zero wiring: consumers arrive M036+.
 */
import { type CommanderDna, type CommanderRecord } from './commanders.js';
import { DNA_MAX, DNA_MIN, type DnaTraits } from './dna.js';
import { dnaDeltasOf, type DoctrineDeltas } from './doctrines.js';
import { dnaPresetOf } from './personalities.js';

/**
 * 50-neutral base (frozen). Duplicates the voted emperor preset by
 * necessity (leaf lookup types `| undefined`, and an unreachable last
 * resort would break 100% branch coverage); conformance with
 * dnaPresetOf('emperor') is proven by test, not by trust.
 */
export const NEUTRAL_DNA: DnaTraits = Object.freeze({
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
});

function clampDna(value: number): number {
  return Math.min(DNA_MAX, Math.max(DNA_MIN, value));
}

/**
 * Effective DNA of a commander (D-027, voted). Total: bare records
 * (commission-minted, no triple) resolve to NEUTRAL_DNA.
 */
export function effectiveDnaOf(record: CommanderRecord): DnaTraits {
  const preset: CommanderDna | undefined =
    record.personality === undefined ? undefined : dnaPresetOf(record.personality);
  const base: CommanderDna = record.dna ?? preset ?? NEUTRAL_DNA;
  const deltas: DoctrineDeltas | undefined =
    record.doctrine === undefined ? undefined : dnaDeltasOf(record.doctrine);
  const at = (trait: keyof CommanderDna): number => clampDna(base[trait] + (deltas?.[trait] ?? 0));
  return {
    aggression: at('aggression'),
    defense: at('defense'),
    economy: at('economy'),
    exploration: at('exploration'),
    risk: at('risk'),
    expansion: at('expansion'),
    diplomacy: at('diplomacy'),
    patience: at('patience'),
    greed: at('greed'),
    adaptability: at('adaptability'),
  };
}
