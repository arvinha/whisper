import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AccountInfo, AccountReason, AuthProvider, Plan } from "@/lib/shared/types";
import disposableDomains from "./disposable-domains.json";
import { AppError } from "./errors";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const TRIAL_DAYS = 2;
export const PLAN_HOURS: Record<Plan, number> = { trial: 3, student: 12, pro: 25, prepaid: 0, none: 0 };
export const EXTRA_SECONDS = 10 * 3600;
/** Keeps access a few days after a failed renewal while Stripe retries the card. */
export const GRACE_DAYS = 3;
const TOKEN_DAYS = 180;
const DAY_MS = 86_400_000;

export type Provider = AuthProvider;

export interface Account {
  id: string;
  email: string;
  name: string;
  /** "" when the account only signs in with e-mail codes or Google/Apple/Microsoft. */
  passwordHash: string;
  /** Subject ids from Google/Apple/Microsoft sign-in. */
  providers?: Partial<Record<Provider, string>>;
  createdAt: string;
  trialEndsAt: string;
  /** This e-mail address, device or network already had a trial, so this account got none. */
  trialDenied?: boolean;
  plan: Plan;
  /** Paid access lasts until this time (subscription period end plus grace, or end of a term pass). */
  paidUntil: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  /** "YYYY-MM" the counter below belongs to. */
  usageMonth: string;
  usedSeconds: number;
  trialUsedSeconds: number;
  /** Bought time (the top-up card); used after the plan's or trial's own hours, and never expires. */
  extraSeconds: number;
  /** Has bought hours at least once, so an empty card says "top up" rather than "trial over". */
  toppedUp?: boolean;
}

interface CodeEntry {
  email: string;
  hash: string;
  exp: number;
  tries: number;
}

interface TrialMark {
  /** "e:" + hashed canonical e-mail, "d:" + hashed device id, or "i:" + hashed IP address. */
  key: string;
  at: number;
}

interface Store {
  accounts: Account[];
  /** Stripe event ids already handled, so a retried webhook does not add hours twice. */
  events: string[];
  /** One-time codes sent by e-mail, hashed. */
  codes: CodeEntry[];
  /** Who has had a trial. Kept when accounts are deleted, so a new account gets no new trial. */
  trials: TrialMark[];
  /** Trial seconds used by all accounts together on one UTC day. */
  trialUsage?: { day: string; seconds: number };
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function sessionSecret(): string {
  return env("SESSION_SECRET");
}

/** Accounts need a session secret and a disk to write to, so they are off on Vercel. */
export function accountsEnabled(): boolean {
  return sessionSecret().length >= 16 && !env("VERCEL");
}

export function billingEnabled(): boolean {
  return accountsEnabled() && /^(sk|rk)_/.test(env("STRIPE_SECRET_KEY"));
}

export function supportEmail(): string {
  return env("SUPPORT_EMAIL");
}

function storePath(): string {
  return path.join(env("DATA_DIR") || path.join(process.cwd(), "data"), "accounts.json");
}

async function readStore(): Promise<Store> {
  try {
    const data = JSON.parse(await fs.readFile(storePath(), "utf8")) as Partial<Store>;
    const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
    return {
      accounts: list(data.accounts),
      events: list(data.events),
      codes: list(data.codes),
      trials: list(data.trials),
      ...(data.trialUsage ? { trialUsage: data.trialUsage } : {}),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { accounts: [], events: [], codes: [], trials: [] };
    throw err;
  }
}

async function writeStore(store: Store): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
  await fs.rename(tmp, file);
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs read-modify-write steps one at a time so two requests never overwrite each other. */
function withStore<T>(fn: (store: Store) => T | Promise<T>, save = true): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    const result = await fn(store);
    if (save) await writeStore(store);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

// ---- passwords and sessions -----------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export const TOKEN_PREFIX = "acc.";

export function makeToken(accountId: string): string {
  const payload = `${accountId}.${Date.now() + TOKEN_DAYS * DAY_MS}`;
  return `${TOKEN_PREFIX}${payload}.${sign(payload)}`;
}

/** The account id in a valid, unexpired session token, otherwise null. */
export function readToken(token: string): string | null {
  if (!accountsEnabled() || !token.startsWith(TOKEN_PREFIX)) return null;
  const [id, exp, sig] = token.slice(TOKEN_PREFIX.length).split(".");
  if (!id || !exp || !sig) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(exp) > Date.now() ? id : null;
}

// ---- rate limits ------------------------------------------------------------------------------

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

const attempts = new Map<string, { count: number; resetAt: number }>();

export function limitAttempts(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > max) {
    throw new AppError(429, "rate_limited", "För många försök. Vänta en stund och försök igen.", {
      retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
    });
  }
}

// ---- accounts ---------------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase().slice(0, 160) : "";
}

const STUDENT_DOMAINS = [
  // Denmark
  "ku.dk", "au.dk", "aau.dk", "sdu.dk", "dtu.dk", "cbs.dk", "ruc.dk", "itu.dk", "via.dk", "ucn.dk", "kp.dk", "phabsalon.dk",
  "ucl.dk", "eaaa.dk", "easj.dk", "zealand.dk", "kea.dk", "cphbusiness.dk", "ucsyd.dk", "eal.dk", "dania.dk", "kadk.dk",
  // Sweden
  "kth.se", "su.se", "lu.se", "uu.se", "gu.se", "chalmers.se", "liu.se", "umu.se", "ltu.se", "mau.se", "miun.se", "kau.se",
  "oru.se", "lnu.se", "hb.se", "hh.se", "hig.se", "his.se", "hj.se", "hkr.se", "hv.se", "mdu.se", "sh.se", "bth.se", "du.se",
  "slu.se", "ki.se", "hhs.se", "konstfack.se", "kmh.se", "gih.se", "fhs.se", "nordakademi.se",
  // Norway
  "uio.no", "ntnu.no", "uib.no", "uit.no", "oslomet.no", "bi.no", "nmbu.no", "usn.no", "hvl.no", "uia.no", "nord.no",
];

/** School and university addresses, for the student price. */
export function isStudentEmail(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  if (!domain) return false;
  if (domain.endsWith(".edu") || /(^|\.)(student|stud|elev|edu)\./.test(domain)) return true;
  return STUDENT_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function monthKey(at = Date.now()): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---- one trial per person ----------------------------------------------------------------------

/**
 * The address mail actually goes to: no "+tag", and for Gmail no dots, so john+2@gmail.com and
 * j.ohn@gmail.com count as john@gmail.com.
 */
export function canonicalEmail(email: string): string {
  const [rawLocal = "", rawDomain = ""] = normalizeEmail(email).split("@");
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** Throwaway inbox services, which would make a new trial a few seconds away. */
const DISPOSABLE = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamailblock.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmail.dev",
  "tempmailo.com", "tempr.email", "yopmail.com", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email",
  "dispostable.com", "maildrop.cc", "mohmal.com", "fakeinbox.com", "emailondeck.com", "throwawaymail.com", "mintemail.com",
  "mailnesia.com", "burnermail.io", "spamgourmet.com", "mytemp.email", "discard.email", "moakt.com", "inboxkitten.com",
  "1secmail.com", "1secmail.net", "1secmail.org", "mailpoof.com", "emailfake.com", "fakemail.net", "tmail.ws", "tmpmail.org",
  "tmpmail.net", "minuteinbox.com", "spambox.us", "mailcatch.com", "linshiyouxiang.net", "dropmail.me", "mail.tm",
  "harakirimail.com", "mailsac.com", "anonaddy.me", "33mail.com", "mvrht.net", "cs.email", "inboxbear.com", "vomoto.com",
];

/** The community list from github.com/disposable-email-domains, plus the ones above. */
const DISPOSABLE_SET = new Set<string>([...(disposableDomains as string[]), ...DISPOSABLE]);

function isDisposable(email: string): boolean {
  const parts = (email.split("@")[1] ?? "").split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_SET.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

/** What the server knows about where a sign-up comes from. */
export interface Origin {
  ip: string;
  /** A random id the app keeps on the phone. */
  device: string;
}

const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function originOf(req: Request, device?: unknown): Origin {
  const given = typeof device === "string" ? device : req.headers.get("x-psst-device") ?? "";
  return { ip: clientIp(req), device: DEVICE_RE.test(given) ? given : "" };
}

/** New trials from one network (a home, a dorm) within a week. More than this get no trial. */
const TRIALS_PER_IP = 3;
const IP_WINDOW_MS = 7 * DAY_MS;
/** The privacy page promises trial marks are gone after a year. */
const MARK_KEEP_MS = 365 * DAY_MS;

/**
 * The network an address belongs to. An IPv6 home or phone gets a whole /64 and can pick any
 * address in it, so only the first four groups say who it is.
 */
export function ipNetwork(ip: string): string {
  const bare = ip.split("%")[0];
  if (!bare.includes(":")) return bare;
  if (bare.includes(".")) return bare.slice(bare.lastIndexOf(":") + 1);
  const [head = "", tail = ""] = bare.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = bare.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function markKey(kind: "e" | "d" | "i", value: string): string {
  return `${kind}:${createHash("sha256").update(`${sessionSecret()}|${value}`).digest("base64url").slice(0, 22)}`;
}

/** Decides whether a new account gets a trial, and remembers the ones that do. */
function grantTrial(store: Store, email: string, origin: Origin, now: number): boolean {
  store.trials = store.trials.filter((m) => now - m.at < (m.key.startsWith("i:") ? IP_WINDOW_MS : MARK_KEEP_MS));
  const emailKey = markKey("e", canonicalEmail(email));
  const deviceKey = origin.device ? markKey("d", origin.device) : "";
  const ipKey = origin.ip && origin.ip !== "local" ? markKey("i", ipNetwork(origin.ip)) : "";
  const used =
    store.trials.some((m) => m.key === emailKey || (deviceKey && m.key === deviceKey)) ||
    (ipKey && store.trials.filter((m) => m.key === ipKey && now - m.at < IP_WINDOW_MS).length >= TRIALS_PER_IP);
  if (used) return false;
  for (const key of [emailKey, deviceKey, ipKey]) if (key) store.trials.push({ key, at: now });
  return true;
}

// ---- creating and finding accounts -------------------------------------------------------------

function findByEmail(store: Store, email: string): Account | undefined {
  const canonical = canonicalEmail(email);
  return store.accounts.find((a) => a.email === email) ?? store.accounts.find((a) => canonicalEmail(a.email) === canonical);
}

function newAccount(store: Store, email: string, name: string, origin: Origin): Account {
  const now = Date.now();
  const trial = grantTrial(store, email, origin, now);
  const account: Account = {
    id: randomUUID(),
    email,
    name,
    passwordHash: "",
    createdAt: new Date(now).toISOString(),
    trialEndsAt: new Date(trial ? now + TRIAL_DAYS * DAY_MS : now).toISOString(),
    ...(trial ? {} : { trialDenied: true }),
    plan: "trial",
    paidUntil: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    usageMonth: monthKey(now),
    usedSeconds: 0,
    trialUsedSeconds: 0,
    extraSeconds: 0,
  };
  store.accounts.push(account);
  return account;
}

function checkNewEmail(email: string): void {
  if (!EMAIL_RE.test(email)) throw new AppError(400, "bad_request", "Skriv en giltig e-postadress.");
  if (isDisposable(email)) {
    throw new AppError(400, "bad_request", "Använd din vanliga e-postadress. Tillfälliga e-postadresser fungerar inte.");
  }
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 60) : "";
}

// ---- e-mail codes -----------------------------------------------------------------------------

const CODE_MINUTES = 15;
const CODE_TRIES = 5;

function codeHash(email: string, code: string): string {
  return createHmac("sha256", sessionSecret()).update(`code|${email}|${code}`).digest("base64url");
}

/** A new six-digit code for this address; earlier codes stop working. */
export async function createCode(emailInput: unknown): Promise<{ email: string; code: string }> {
  const email = normalizeEmail(emailInput);
  checkNewEmail(email);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await withStore((store) => {
    const now = Date.now();
    store.codes = store.codes.filter((c) => c.email !== email && c.exp > now);
    store.codes.push({ email, hash: codeHash(email, code), exp: now + CODE_MINUTES * 60_000, tries: 0 });
  });
  return { email, code };
}

/**
 * Signs in with a code from the e-mail. Creates the account the first time; with a password it
 * also sets a new one (forgotten password).
 */
export async function signInWithCode(input: {
  email: unknown;
  code: unknown;
  name?: unknown;
  password?: unknown;
  origin: Origin;
}): Promise<Account> {
  const email = normalizeEmail(input.email);
  const code = typeof input.code === "string" ? input.code.replace(/\D/g, "") : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (password && (password.length < 8 || password.length > 200)) {
    throw new AppError(400, "bad_request", "Lösenordet måste ha minst 8 tecken.");
  }
  const passwordHash = password ? await hashPassword(password) : "";
  return withStore((store) => {
    const now = Date.now();
    const entry = store.codes.find((c) => c.email === email && c.exp > now);
    if (!entry || entry.tries >= CODE_TRIES) {
      throw new AppError(400, "bad_request", "Koden har gått ut. Be om en ny kod.");
    }
    const expected = Buffer.from(entry.hash);
    const given = Buffer.from(codeHash(email, code));
    if (code.length !== 6 || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      entry.tries += 1;
      throw new AppError(400, "bad_request", "Fel kod. Kolla mejlet och försök igen.");
    }
    store.codes = store.codes.filter((c) => c !== entry);
    const account = findByEmail(store, email) ?? newAccount(store, email, cleanName(input.name), input.origin);
    if (passwordHash) account.passwordHash = passwordHash;
    return account;
  });
}

// ---- Google, Apple, Microsoft -----------------------------------------------------------------

/** Signs in with an identity checked by Google, Apple or Microsoft; links to an account with the same address. */
export function signInWithProvider(input: {
  provider: Provider;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  origin: Origin;
}): Promise<Account> {
  const email = normalizeEmail(input.email);
  return withStore((store) => {
    let account = store.accounts.find((a) => a.providers?.[input.provider] === input.subject);
    if (!account && email && input.emailVerified) account = findByEmail(store, email);
    if (!account) {
      if (!EMAIL_RE.test(email)) throw new AppError(400, "bad_request", "Kontot gav ingen e-postadress. Logga in med e-post i stället.");
      account = newAccount(store, email, cleanName(input.name), input.origin);
    }
    account.providers = { ...account.providers, [input.provider]: input.subject };
    if (!account.name && input.name) account.name = cleanName(input.name);
    return account;
  });
}

export async function login(emailInput: unknown, passwordInput: unknown): Promise<Account> {
  const email = normalizeEmail(emailInput);
  const password = typeof passwordInput === "string" ? passwordInput : "";
  const account = await withStore((store) => findByEmail(store, email) ?? null, false);
  const ok =
    account?.passwordHash ? await checkPassword(password, account.passwordHash) : await hashPassword(password).then(() => false);
  if (!account || !ok) throw new AppError(401, "unauthorized", "Fel e-post eller lösenord.");
  return account;
}

export function getAccount(id: string): Promise<Account | null> {
  return withStore((store) => store.accounts.find((a) => a.id === id) ?? null, false);
}

export function findAccount(match: (a: Account) => boolean): Promise<Account | null> {
  return withStore((store) => store.accounts.find(match) ?? null, false);
}

/** Changes one account. Returns null if it no longer exists. */
export function updateAccount(id: string, change: (a: Account) => void): Promise<Account | null> {
  return withStore((store) => {
    const account = store.accounts.find((a) => a.id === id);
    if (account) change(account);
    return account ?? null;
  });
}

/** Runs `handle` once per Stripe event id. */
export function onceForEvent(eventId: string, handle: (accounts: Account[]) => void): Promise<boolean> {
  return withStore((store) => {
    if (store.events.includes(eventId)) return false;
    handle(store.accounts);
    store.events = [...store.events, eventId].slice(-500);
    return true;
  });
}

// ---- access and usage -------------------------------------------------------------------------

function paidActive(a: Account, now: number): boolean {
  return (a.plan === "student" || a.plan === "pro") && !!a.paidUntil && Date.parse(a.paidUntil) > now;
}

function currentUsed(a: Account, now: number): number {
  return a.usageMonth === monthKey(now) ? a.usedSeconds : 0;
}

export interface Access {
  active: boolean;
  reason: AccountReason;
  /** The plan that counts right now: a paid plan while it lasts, otherwise the trial. */
  plan: Plan;
  limitSeconds: number;
  usedSeconds: number;
}

export function accessOf(a: Account, now = Date.now()): Access {
  if (paidActive(a, now)) {
    const limitSeconds = PLAN_HOURS[a.plan] * 3600;
    const usedSeconds = currentUsed(a, now);
    const active = usedSeconds < limitSeconds || a.extraSeconds > 0;
    return { active, reason: active ? "" : "quota", plan: a.plan, limitSeconds, usedSeconds };
  }
  const limitSeconds = PLAN_HOURS.trial * 3600;
  const trialRunning = trialOn(a, now);
  if (trialRunning && a.trialUsedSeconds < limitSeconds) {
    return { active: true, reason: "", plan: "trial", limitSeconds, usedSeconds: a.trialUsedSeconds };
  }
  if (a.extraSeconds > 0) {
    return { active: true, reason: "", plan: "prepaid", limitSeconds: 0, usedSeconds: 0 };
  }
  if (a.toppedUp) return { active: false, reason: "empty", plan: "prepaid", limitSeconds: 0, usedSeconds: 0 };
  if (a.plan !== "trial" && a.paidUntil) {
    return { active: false, reason: "expired", plan: a.plan, limitSeconds: 0, usedSeconds: 0 };
  }
  if (trialRunning) return { active: false, reason: "quota", plan: "trial", limitSeconds, usedSeconds: a.trialUsedSeconds };
  return { active: false, reason: "trial_over", plan: "trial", limitSeconds, usedSeconds: a.trialUsedSeconds };
}

function trialOn(a: Account, now: number): boolean {
  return a.plan === "trial" && Date.parse(a.trialEndsAt) > now;
}

function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Trial hours all accounts together may use per day (TRIAL_DAILY_HOURS), so free use has a known daily cost. */
function trialDailySeconds(): number {
  const hours = Number(env("TRIAL_DAILY_HOURS"));
  return (Number.isFinite(hours) && hours > 0 ? hours : 40) * 3600;
}

/** False once today's free trial hours are used up; paid and bought hours are not affected. */
export function trialBudgetOpen(): Promise<boolean> {
  return withStore((store) => {
    const usage = store.trialUsage;
    return !usage || usage.day !== dayKey() || usage.seconds < trialDailySeconds();
  }, false);
}

/** Counts listened time: the plan's or trial's own hours first, then bought hours. */
export function recordUsage(id: string, seconds: number): Promise<Account | null> {
  if (!(seconds > 0)) return getAccount(id);
  return withStore((store) => {
    const a = store.accounts.find((x) => x.id === id);
    if (!a) return null;
    const now = Date.now();
    const paid = paidActive(a, now);
    if (paid && a.usageMonth !== monthKey(now)) {
      a.usageMonth = monthKey(now);
      a.usedSeconds = 0;
    }
    const trial = !paid && trialOn(a, now);
    const limit = paid ? PLAN_HOURS[a.plan] * 3600 : trial ? PLAN_HOURS.trial * 3600 : 0;
    const used = paid ? a.usedSeconds : a.trialUsedSeconds;
    const fromPlan = Math.min(Math.max(0, limit - used), seconds);
    if (paid) a.usedSeconds = used + fromPlan;
    else if (trial) {
      a.trialUsedSeconds = used + fromPlan;
      const day = dayKey(now);
      store.trialUsage = { day, seconds: (store.trialUsage?.day === day ? store.trialUsage.seconds : 0) + fromPlan };
    }
    a.extraSeconds = Math.max(0, a.extraSeconds - (seconds - fromPlan));
    return a;
  });
}

export function accountInfo(a: Account): AccountInfo {
  const access = accessOf(a);
  const subscribed = !!a.stripeSubscriptionId && paidActive(a, Date.now());
  const periodEnd =
    a.paidUntil && subscribed ? new Date(Date.parse(a.paidUntil) - GRACE_DAYS * DAY_MS).toISOString() : a.paidUntil;
  return {
    email: a.email,
    name: a.name,
    plan: access.plan,
    active: access.active,
    reason: access.reason,
    usedSeconds: Math.round(access.usedSeconds),
    limitSeconds: access.limitSeconds,
    extraSeconds: Math.round(a.extraSeconds),
    trialEndsAt: a.trialEndsAt,
    trialDenied: !!a.trialDenied,
    paidUntil: periodEnd,
    subscribed,
    cancelAtPeriodEnd: a.cancelAtPeriodEnd,
    hasBilling: !!a.stripeCustomerId,
    student: isStudentEmail(a.email),
  };
}
