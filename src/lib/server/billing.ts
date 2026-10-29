import { createHmac, timingSafeEqual } from "node:crypto";
import { CUSTOM_TOPUP_MAX, krToOre, TOPUPS, type Currency } from "@/lib/shared/pricing";
import type { CheckoutKind } from "@/lib/shared/types";
import { addBalance, billingEnabled, findAccount, onceForEvent, updateAccount, type Account } from "./accounts";
import { AppError } from "./errors";

const API = "https://api.stripe.com/v1";

/**
 * Stripe prices are created the first time they are needed and cannot change, so a new amount
 * needs a new lookup key.
 */
const LOOKUP_KEYS: Record<CheckoutKind, string> = {
  kr50: "whisper_topup_50_v1",
  kr100: "whisper_topup_100_v1",
  kr250: "whisper_topup_250_v1",
};

export const CUSTOM_KIND = "custom";

export function parseCheckoutKind(value: unknown): CheckoutKind | null {
  return typeof value === "string" && value in TOPUPS ? (value as CheckoutKind) : null;
}

/** Where Stripe sends the user back: APP_URL, or the address the request came in on. */
export function appOrigin(req: Request): string {
  const fixed = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

function secretKey(): string {
  return (process.env.STRIPE_SECRET_KEY ?? "").trim();
}

type Params = Record<string, string | number | boolean | undefined>;

async function stripe<T>(method: "GET" | "POST", path: string, params: Params = {}): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.append(key, String(value));
  }
  const url = method === "GET" && [...body].length ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${secretKey()}`,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    console.error("[whisper] stripe error", res.status, data.error?.message);
    throw new AppError(502, "provider_error", "Betalningen kunde inte startas. Försök igen om en stund.");
  }
  return data;
}

const priceIds = new Map<CheckoutKind, string>();

async function priceId(kind: CheckoutKind): Promise<string> {
  const cached = priceIds.get(kind);
  if (cached) return cached;
  const { sek, dkk } = TOPUPS[kind];
  const found = await stripe<{ data: Array<{ id: string }> }>("GET", "/prices", {
    "lookup_keys[]": LOOKUP_KEYS[kind],
    active: true,
    limit: 1,
  });
  let id = found.data[0]?.id;
  if (!id) {
    const created = await stripe<{ id: string }>("POST", "/prices", {
      currency: "sek",
      unit_amount: sek * 100,
      tax_behavior: "inclusive",
      "currency_options[dkk][unit_amount]": dkk * 100,
      "currency_options[dkk][tax_behavior]": "inclusive",
      "product_data[name]": `Whisper saldo ${sek} SEK / ${dkk} DKK`,
      lookup_key: LOOKUP_KEYS[kind],
    });
    id = created.id;
  }
  priceIds.set(kind, id);
  return id;
}

async function customerId(account: Account): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await stripe<{ id: string }>("POST", "/customers", {
    email: account.email,
    name: account.name || undefined,
    "metadata[accountId]": account.id,
  });
  await updateAccount(account.id, (a) => {
    a.stripeCustomerId = customer.id;
  });
  return customer.id;
}

function requireBilling(): void {
  if (!billingEnabled()) throw new AppError(503, "not_configured", "Betalning är inte igång än.");
}

/** A Stripe Checkout page for a pack. */
export async function checkoutUrl(account: Account, kind: CheckoutKind, origin: string): Promise<string> {
  requireBilling();
  return checkoutSession(account, origin, { "line_items[0][price]": await priceId(kind), "metadata[kind]": kind });
}

/** A Stripe Checkout page for the user's own amount, in whole kronor of the account's currency. */
export async function customCheckoutUrl(account: Account, kr: number, currency: Currency, origin: string): Promise<string> {
  requireBilling();
  const ore = krToOre(kr, currency);
  return checkoutSession(account, origin, {
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": kr * 100,
    "line_items[0][price_data][tax_behavior]": "inclusive",
    "line_items[0][price_data][product_data][name]": `Whisper saldo ${kr} ${currency.toUpperCase()}`,
    "metadata[kind]": CUSTOM_KIND,
    "metadata[creditOre]": ore,
  });
}

async function checkoutSession(account: Account, origin: string, item: Params): Promise<string> {
  const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
    mode: "payment",
    customer: await customerId(account),
    client_reference_id: account.id,
    ...item,
    "line_items[0][quantity]": 1,
    "metadata[accountId]": account.id,
    "invoice_creation[enabled]": true,
    allow_promotion_codes: true,
    locale: "auto",
    success_url: `${origin}/?betalning=klar`,
    cancel_url: `${origin}/?betalning=avbruten`,
  });
  return session.url;
}

/** Receipts for earlier top-ups. */
export async function portalUrl(account: Account, origin: string): Promise<string> {
  requireBilling();
  const session = await stripe<{ url: string }>("POST", "/billing_portal/sessions", {
    customer: await customerId(account),
    return_url: `${origin}/`,
  });
  return session.url;
}

// ---- webhook ----------------------------------------------------------------------------------

/** Checks the Stripe-Signature header (HMAC-SHA256 of "timestamp.body", 5 minute tolerance). */
export function verifyWebhook(body: string, header: string | null): boolean {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"));
  return parts.some(([k, v]) => {
    if (k !== "v1" || !v) return false;
    const given = Buffer.from(v);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface StripeCheckoutSession {
  mode: string;
  payment_status: string;
  currency?: string | null;
  client_reference_id?: string | null;
  customer?: string | null;
  metadata?: Record<string, string>;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

async function accountFor(id: string | undefined | null, customer: string | undefined | null): Promise<Account | null> {
  if (id) {
    const found = await findAccount((a) => a.id === id);
    if (found) return found;
  }
  return customer ? findAccount((a) => a.stripeCustomerId === customer) : null;
}

export async function handleWebhook(event: StripeEvent): Promise<void> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return;
  const session = event.data.object as StripeCheckoutSession;
  if (session.mode !== "payment" || session.payment_status !== "paid") return;
  const ore = creditOf(session.metadata);
  if (!ore) return;
  const account = await accountFor(session.metadata?.accountId ?? session.client_reference_id, session.customer);
  if (!account) return;
  await onceForEvent(event.id, (accounts) => {
    const a = accounts.find((x) => x.id === account.id);
    if (a) addBalance(a, ore, session.currency === "dkk" ? "dkk" : "sek");
  });
}

/** Balance öre a paid session adds. Only this server writes the metadata, with Stripe's secret key. */
function creditOf(metadata: Record<string, string> | undefined): number {
  const kind = parseCheckoutKind(metadata?.kind);
  if (kind) return TOPUPS[kind].sek * 100;
  if (metadata?.kind !== CUSTOM_KIND) return 0;
  const ore = Number(metadata.creditOre);
  return Number.isSafeInteger(ore) && ore > 0 && ore <= krToOre(CUSTOM_TOPUP_MAX, "dkk") ? ore : 0;
}
