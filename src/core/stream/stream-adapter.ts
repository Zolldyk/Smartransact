import type { Result } from "../result.js";

export interface StreamAdapter {
  start(signal: AbortSignal): Promise<Result<void, { reason: string }>>;
  trackSignature?(signature: string, signal: AbortSignal): void;
}
