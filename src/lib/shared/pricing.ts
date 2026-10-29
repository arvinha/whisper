import type { CheckoutKind } from "./types";

/**
 * Pay as you go, VAT included. The balance is kept in Swedish öre; Danish accounts see it in DKK
 * at DKK_PER_SEK, which is also how the DKK top-up prices are set.
 */
export const LISTEN_ORE_PER_MINUTE = 10;
export const ANSWER_ORE = 50;
export const TRIAL_MINUTES = 20;
/** Answers are free in the trial, up to this many, so one trial has a known worst-case cost. */
export const TRIAL_MAX_ANSWERS = 40;
export const DKK_PER_SEK = 0.7;

/** Top-ups: `sek` is both the SEK price and the credit; `dkk` is the DKK price for the same credit. */
export const TOPUPS: Record<CheckoutKind, { sek: number; dkk: number }> = {
  kr50: { sek: 50, dkk: 35 },
  kr100: { sek: 100, dkk: 70 },
  kr250: { sek: 250, dkk: 175 },
};
export const TOPUP_KINDS = Object.keys(TOPUPS) as CheckoutKind[];

/** A top-up of the user's own amount: whole kronor in the account's currency, within these limits. */
export const CUSTOM_TOPUP_MIN = 10;
export const CUSTOM_TOPUP_MAX = 2000;

export type Currency = "sek" | "dkk";

/** Öre (SEK) in the given currency's kronor, e.g. 5000 → 50 (SEK) or 35 (DKK). */
export function oreToKr(ore: number, currency: Currency): number {
  return (ore / 100) * (currency === "dkk" ? DKK_PER_SEK : 1);
}

/** Kronor in the given currency as balance öre (SEK), e.g. 35 DKK → 5000. */
export function krToOre(kr: number, currency: Currency): number {
  return Math.round((kr * 100) / (currency === "dkk" ? DKK_PER_SEK : 1));
}

/** A valid custom top-up amount, or null. */
export function customTopUp(value: unknown): number | null {
  const kr = typeof value === "number" ? value : Number(value);
  return Number.isInteger(kr) && kr >= CUSTOM_TOPUP_MIN && kr <= CUSTOM_TOPUP_MAX ? kr : null;
}
