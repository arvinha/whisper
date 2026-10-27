import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutKind, PackKind, Plan } from "@/lib/shared/types";
import {
  EXTRA_SECONDS,
  GRACE_DAYS,
  billingEnabled,
  findAccount,
  isStudentEmail,
  onceForEvent,
  updateAccount,
  type Account,
} from "./accounts";
import { AppError } from "./errors";

const API = "https://api.stripe.com/v1";
const DAY_MS = 86_400_000;
const TERM_DAYS = 150;

interface PriceSpec {
  lookupKey: string;
  name: string;
  sek: number;
  dkk: number;
  monthly: boolean;
}

/**
 * Prices in öre/øre, VAT included. Created in Stripe the first time they are needed. Stripe prices
 * cannot change, so a new price needs a new lookup key.
 */
export const PRICES: Record<CheckoutKind, PriceSpec> = {
  pack5: { lookupKey: "whisper_pack_5h_v1", name: "Whisper – 5 timmar", sek: 4900, dkk: 3500, monthly: false },
  pack15: { lookupKey: "whisper_pack_15h_v1", name: "Whisper – 15 timmar", sek: 11900, dkk: 8500, monthly: false },
  pack40: { lookupKey: "whisper_pack_40h_v1", name: "Whisper – 40 timmar", sek: 24900, dkk: 17900, monthly: false },
  student: { lookupKey: "whisper_student_monthly", name: "Whisper Student", sek: 5900, dkk: 3900, monthly: true },
  termin: { lookupKey: "whisper_student_term", name: "Whisper Student – termin (5 månader)", sek: 24900, dkk: 16900, monthly: false },
  pro: { lookupKey: "whisper_pro_monthly", name: "Whisper Pro", sek: 12900, dkk: 8900, monthly: true },
  extra: { lookupKey: "whisper_extra_10h_v2", name: "Whisper – 10 extra timmar", sek: 4900, dkk: 3500, monthly: false },
};

export function parseCheckoutKind(value: unknown): CheckoutKind | null {
  return typeof value === "string" && value in PRICES ? (value as CheckoutKind) : null;
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
  const spec = PRICES[kind];
  const found = await stripe<{ data: Array<{ id: string }> }>("GET", "/prices", {
    "lookup_keys[]": spec.lookupKey,
    active: true,
    limit: 1,
  });
  let id = found.data[0]?.id;
  if (!id) {
    const created = await stripe<{ id: string }>("POST", "/prices", {
      currency: "sek",
      unit_amount: spec.sek,
      tax_behavior: "inclusive",
      "currency_options[dkk][unit_amount]": spec.dkk,
      "currency_options[dkk][tax_behavior]": "inclusive",
      "product_data[name]": spec.name,
      lookup_key: spec.lookupKey,
      "recurring[interval]": spec.monthly ? "month" : undefined,
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

/** A Stripe Checkout page for the plan, or the billing portal if a subscription already runs. */
export async function checkoutUrl(account: Account, kind: CheckoutKind, origin: string): Promise<string> {
  requireBilling();
  if ((kind === "student" || kind === "termin") && !isStudentEmail(account.email)) {
    throw new AppError(400, "bad_request", "Studentpriset kräver ett konto med din skol- eller universitetsmejl.");
  }
  const running = account.stripeSubscriptionId && account.paidUntil && Date.parse(account.paidUntil) > Date.now();
  if (PRICES[kind].monthly && running) return portalUrl(account, origin);

  const customer = await customerId(account);
  const subscription = PRICES[kind].monthly;
  const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
    mode: subscription ? "subscription" : "payment",
    customer,
    client_reference_id: account.id,
    "line_items[0][price]": await priceId(kind),
    "line_items[0][quantity]": 1,
    "metadata[accountId]": account.id,
    "metadata[kind]": kind,
    ...(subscription
      ? { "subscription_data[metadata][accountId]": account.id, "subscription_data[metadata][kind]": kind }
      : { "invoice_creation[enabled]": true }),
    allow_promotion_codes: true,
    locale: "auto",
    success_url: `${origin}/?betalning=klar`,
    cancel_url: `${origin}/?betalning=avbruten`,
  });
  return session.url;
}

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

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ current_period_end?: number; price?: { lookup_key?: string | null } }> };
}

interface StripeCheckoutSession {
  mode: string;
  payment_status: string;
  client_reference_id?: string | null;
  customer?: string | null;
  subscription?: string | null;
  metadata?: Record<string, string>;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

function planOfSubscription(sub: StripeSubscription): Plan {
  const kind = sub.metadata?.kind ?? "";
  const lookup = sub.items?.data?.[0]?.price?.lookup_key ?? "";
  if (kind === "pro" || lookup === PRICES.pro.lookupKey) return "pro";
  return "student";
}

function periodEnd(sub: StripeSubscription): number {
  const seconds = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? 0;
  return seconds * 1000;
}

function applySubscription(a: Account, sub: StripeSubscription): void {
  const live = ["active", "trialing", "past_due"].includes(sub.status);
  a.stripeSubscriptionId = live ? sub.id : null;
  a.cancelAtPeriodEnd = live && !!sub.cancel_at_period_end;
  if (live) {
    a.plan = planOfSubscription(sub);
    a.paidUntil = new Date(periodEnd(sub) + GRACE_DAYS * DAY_MS).toISOString();
  } else if (a.paidUntil && Date.parse(a.paidUntil) > Date.now()) {
    a.paidUntil = new Date().toISOString();
  }
}

/** Hours on the top-up card for each pack. */
export const PACK_HOURS: Record<PackKind, number> = { pack5: 5, pack15: 15, pack40: 40 };

function applyPayment(a: Account, kind: string): void {
  if (kind in PACK_HOURS) {
    a.extraSeconds += PACK_HOURS[kind as PackKind] * 3600;
    a.toppedUp = true;
  } else if (kind === "extra") {
    a.extraSeconds += EXTRA_SECONDS;
  } else if (kind === "termin") {
    const from = a.plan === "student" && a.paidUntil ? Math.max(Date.parse(a.paidUntil), Date.now()) : Date.now();
    a.plan = "student";
    a.paidUntil = new Date(from + TERM_DAYS * DAY_MS).toISOString();
  }
}

async function accountFor(id: string | undefined | null, customer: string | undefined | null): Promise<Account | null> {
  if (id) {
    const found = await findAccount((a) => a.id === id);
    if (found) return found;
  }
  return customer ? findAccount((a) => a.stripeCustomerId === customer) : null;
}

export async function handleWebhook(event: StripeEvent): Promise<void> {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as StripeCheckoutSession;
    const account = await accountFor(session.metadata?.accountId ?? session.client_reference_id, session.customer);
    if (!account) return;
    if (session.mode === "subscription" && session.subscription) {
      const sub = await stripe<StripeSubscription>("GET", `/subscriptions/${session.subscription}`);
      await onceForEvent(event.id, (accounts) => {
        const a = accounts.find((x) => x.id === account.id);
        if (a) applySubscription(a, sub);
      });
    } else if (session.mode === "payment" && session.payment_status === "paid") {
      await onceForEvent(event.id, (accounts) => {
        const a = accounts.find((x) => x.id === account.id);
        if (a) applyPayment(a, session.metadata?.kind ?? "");
      });
    }
    return;
  }

  if (event.type.startsWith("customer.subscription.")) {
    const sub = event.data.object as StripeSubscription;
    const account = await accountFor(sub.metadata?.accountId, sub.customer);
    if (!account) return;
    // Fetch the current state, since subscription events can arrive out of order.
    const current =
      event.type === "customer.subscription.deleted"
        ? sub
        : await stripe<StripeSubscription>("GET", `/subscriptions/${sub.id}`).catch(() => sub);
    await updateAccount(account.id, (a) => {
      if (a.stripeSubscriptionId && a.stripeSubscriptionId !== current.id && current.status === "canceled") return;
      applySubscription(a, current);
    });
  }
}
