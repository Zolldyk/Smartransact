/**
 * Result<T, E> — explicit success/failure return type used by every module
 * that makes external calls. No exceptions for expected failures; callers
 * narrow on `.ok` and propagate failures up the stack.
 *
 * Zero external dependencies by design — this is the lowest-level primitive.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; failure: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function fail<E>(failure: E): Result<never, E> {
  return { ok: false, failure };
}
