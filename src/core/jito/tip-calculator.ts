import { type TipMarketData } from "../../schemas/observation-schema.js";
import { type Guardrails } from "../../schemas/config-schema.js";
import { JITO_MIN_TIP_LAMPORTS } from "../protocol.js";

export function computeTip(tipMarket: TipMarketData, guardrails: Guardrails): bigint {
  const derived = BigInt(Math.round(tipMarket.emaP50));
  const floor = derived < JITO_MIN_TIP_LAMPORTS ? JITO_MIN_TIP_LAMPORTS : derived;
  const bandFloor = BigInt(guardrails.tipBand[0]);
  const ceiling = BigInt(guardrails.maxTipLamports);
  const clamped = floor < bandFloor ? bandFloor : floor > ceiling ? ceiling : floor;
  return clamped;
}
