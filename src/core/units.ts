/**
 * Bigint unit helpers for lamports and slots. In all core code, lamports, slots,
 * and blockhash heights are bigint. These helpers coerce to/from bigint and
 * provide the single sanctioned bigint→number serializer used by the evidence
 * logger.
 *
 * Zero imports from other src/ files (no zod dependency).
 *
 * Rule: `Number()` on a bigint is banned outside this file. All call sites use
 * `serializeBigInt`, `lamportsToNumber`, or `slotsToNumber`.
 */

export function toLamports(n: number | bigint): bigint {
  return toBigInt(n, "lamports");
}

export function toSlots(n: number | bigint): bigint {
  return toBigInt(n, "slots");
}

function toBigInt(n: number | bigint, unit: string): bigint {
  if (typeof n === "number" && !Number.isInteger(n)) {
    throw new Error(`cannot convert non-integer ${n} to ${unit} bigint`);
  }
  return BigInt(n);
}

export function lamportsToNumber(l: bigint): number {
  return serializeBigInt(l);
}

export function slotsToNumber(s: bigint): number {
  return serializeBigInt(s);
}

/** Convert bigint to a JSON-safe number. Throws if value falls outside the
 * safe integer range, since those would be silently corrupted. Used by the
 * evidence logger's central serializer — never call Number() on bigints elsewhere.
 */
export function serializeBigInt(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(
      `bigint ${v} is outside the safe integer range — cannot serialize safely`,
    );
  }
  return Number(v);
}
