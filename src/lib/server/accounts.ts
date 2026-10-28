import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { ANSWER_ORE, LISTEN_ORE_PER_MINUTE, TRIAL_MAX_ANSWERS, TRIAL_MINUTES, type Currency } from "@/lib/shared/pricing";
import { TERMS_VERSION } from "@/lib/shared/terms";
import type { AccountInfo, AccountReason, AuthProvider, Plan } from "@/lib/shared/types";
import disposableDomains from "./disposable-domains.json";
import { AppError } from "./errors";
import { smsCountries, smsDailyMax } from "./sms";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const TRIAL_SECONDS = TRIAL_MINUTES * 60;
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
  /** Mobile number in +46… form, checked with a texted code. One account per number. */
  phone?: string;
  /** The version of the terms accepted, and when. */
  termsVersion?: string;
  termsAcceptedAt?: string;
  /** Signed up with Google/Apple/Microsoft: the trial is decided once the phone number is checked. */
  trialPending?: boolean;
  /** This e-mail address, phone number, device or network already had a trial, so this account got none. */
  trialDenied?: boolean;
  /** Seconds of speech listened to on the free minutes. */
  trialUsedSeconds: number;
  /** Answers given on the free minutes. */
  trialAnswers: number;
  /** Bought balance in Swedish öre; used after the free minutes, and never expires. */
  balanceOre: number;
  /** The currency of the first top-up, so the balance is shown in it. */
  currency?: Currency;
  stripeCustomerId: string | null;
  /** Has topped up at least once, so an empty balance says "top up" rather than "trial over". */
  toppedUp?: boolean;
}

interface CodeEntry {
  email: string;
  hash: string;
  exp: number;
  tries: number;
}

interface SmsCodeEntry {
  phone: string;
  hash: string;
  exp: number;
  tries: number;
}

/** A sign-up waiting for the codes from the e-mail and the text message. */
interface PendingSignup {
  email: string;
  name: string;
  phone: string;
  passwordHash: string;
  exp: number;
}

interface TrialMark {
  /** "e:" + hashed canonical e-mail, "p:" + hashed phone number, "d:" + hashed device id, or "i:" + hashed IP address. */
  key: string;
  at: number;
}

interface Store {
  accounts: Account[];
  /** Stripe event ids already handled, so a retried webhook does not add hours twice. */
  events: string[];
  /** One-time codes sent by e-mail, hashed. */
  codes: CodeEntry[];
  /** One-time codes sent by text message, hashed. */
  smsCodes: SmsCodeEntry[];
  signups: PendingSignup[];
  /** Who has had a trial. Kept when accounts are deleted, so a new account gets no new trial. */
  trials: TrialMark[];
  /** Trial seconds used by all accounts together on one UTC day. */
  trialUsage?: { day: string; seconds: number };
  /** Text messages sent on one UTC day. */
  smsUsage?: { day: string; count: number };
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

/** Accounts saved before pay-as-you-go have no balance or trial answer counter. */
function withDefaults(a: Account): Account {
  a.trialUsedSeconds ??= 0;
  a.trialAnswers ??= 0;
  a.balanceOre ??= 0;
  return a;
}

async function readStore(): Promise<Store> {
  try {
    const data = JSON.parse(await fs.readFile(storePath(), "utf8")) as Partial<Store>;
    const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
    return {
      accounts: list(data.accounts).map(withDefaults),
      events: list(data.events),
      codes: list(data.codes),
      smsCodes: list(data.smsCodes),
      signups: list(data.signups),
      trials: list(data.trials),
      ...(data.trialUsage ? { trialUsage: data.trialUsage } : {}),
      ...(data.smsUsage ? { smsUsage: data.smsUsage } : {}),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { accounts: [], events: [], codes: [], smsCodes: [], signups: [], trials: [] };
    }
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

/**
 * Runs read-modify-write steps one at a time so two requests never overwrite each other. A step
 * that refuses with an AppError is still saved, so a wrong code counts as a try.
 */
function withStore<T>(fn: (store: Store) => T | Promise<T>, save = true): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    let result: T;
    try {
      result = await fn(store);
    } catch (err) {
      if (save && err instanceof AppError) await writeStore(store);
      throw err;
    }
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

function markKey(kind: "e" | "p" | "d" | "i", value: string): string {
  return `${kind}:${createHash("sha256").update(`${sessionSecret()}|${value}`).digest("base64url").slice(0, 22)}`;
}

/**
 * Decides whether an account gets a trial, and remembers the ones that do. Every trial needs a
 * checked phone number; the e-mail, phone, device and network must not have had one before.
 */
function grantTrial(store: Store, email: string, phone: string, origin: Origin, now: number): boolean {
  store.trials = store.trials.filter((m) => now - m.at < (m.key.startsWith("i:") ? IP_WINDOW_MS : MARK_KEEP_MS));
  const emailKey = markKey("e", canonicalEmail(email));
  const phoneKey = markKey("p", phone);
  const deviceKey = origin.device ? markKey("d", origin.device) : "";
  const ipKey = origin.ip && origin.ip !== "local" ? markKey("i", ipNetwork(origin.ip)) : "";
  const used =
    store.trials.some((m) => m.key === emailKey || m.key === phoneKey || (deviceKey && m.key === deviceKey)) ||
    (ipKey && store.trials.filter((m) => m.key === ipKey && now - m.at < IP_WINDOW_MS).length >= TRIALS_PER_IP);
  if (used) {
    markPhone(store, phone, now);
    return false;
  }
  for (const key of [emailKey, phoneKey, deviceKey, ipKey]) if (key) store.trials.push({ key, at: now });
  return true;
}

/** Remembers that this phone number has been on an account, so it never starts another trial. */
function markPhone(store: Store, phone: string, now: number): void {
  const key = markKey("p", phone);
  if (!store.trials.some((m) => m.key === key)) store.trials.push({ key, at: now });
}

// ---- creating and finding accounts -------------------------------------------------------------

function findByEmail(store: Store, email: string): Account | undefined {
  const canonical = canonicalEmail(email);
  return store.accounts.find((a) => a.email === email) ?? store.accounts.find((a) => canonicalEmail(a.email) === canonical);
}

function phoneTaken(store: Store, phone: string, exceptId = ""): boolean {
  return store.accounts.some((a) => a.phone === phone && a.id !== exceptId);
}

/** A new account. Without a checked phone number it gets no trial until one is added. */
function newAccount(store: Store, input: { email: string; name: string; origin: Origin; phone?: string; passwordHash?: string }): Account {
  const now = Date.now();
  const account: Account = {
    id: randomUUID(),
    email: input.email,
    name: input.name,
    passwordHash: input.passwordHash ?? "",
    createdAt: new Date(now).toISOString(),
    trialUsedSeconds: 0,
    trialAnswers: 0,
    balanceOre: 0,
    stripeCustomerId: null,
  };
  if (input.phone) {
    account.phone = input.phone;
    if (!grantTrial(store, input.email, input.phone, input.origin, now)) account.trialDenied = true;
  } else {
    account.trialPending = true;
  }
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

function newPassword(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  if (password.length < 8 || password.length > 200) throw new AppError(400, "bad_request", "Lösenordet måste ha minst 8 tecken.");
  return password;
}

function termsAccepted(value: unknown): void {
  if (value !== true) throw new AppError(400, "bad_request", "Du behöver godkänna villkoren för att fortsätta.");
}

/** An account must have a checked phone number, today's terms, and a way to log in before it can be used. */
function needsSetup(a: Account): boolean {
  const canLogIn = !!a.passwordHash || Object.keys(a.providers ?? {}).length > 0;
  return !a.phone || a.termsVersion !== TERMS_VERSION || !canLogIn;
}

// ---- phone numbers ----------------------------------------------------------------------------

/**
 * A mobile number in +46… form. Without a country code it is read as Swedish, Danish, Norwegian or
 * Finnish, the app language's country first. Landlines, internet (VoIP) numbers and countries outside
 * SMS_COUNTRIES are refused.
 */
export function normalizePhone(input: unknown, lang: string): string {
  const raw = typeof input === "string" ? input.replace(/[^\d+]/g, "").replace(/^00/, "+").slice(0, 20) : "";
  const first: CountryCode = lang === "da" ? "DK" : "SE";
  const countries: CountryCode[] = [first, ...(["SE", "DK", "NO", "FI"] as CountryCode[]).filter((c) => c !== first)];
  let valid = null;
  for (const country of raw.startsWith("+") ? [first] : countries) {
    const parsed = parsePhoneNumberFromString(raw, country);
    if (!parsed?.isValid()) continue;
    valid ??= parsed;
    const type = parsed.getType();
    if (type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE") {
      valid = parsed;
      break;
    }
  }
  if (!valid) throw new AppError(400, "bad_request", "Skriv ett giltigt mobilnummer, till exempel 070 123 45 67.");
  const type = valid.getType();
  if (type !== "MOBILE" && type !== "FIXED_LINE_OR_MOBILE") {
    throw new AppError(400, "bad_request", "Använd ditt vanliga mobilnummer. Fasta nummer och internetnummer fungerar inte.");
  }
  if (!valid.country || !smsCountries().includes(valid.country)) {
    throw new AppError(400, "bad_request", "Vi kan inte skicka SMS till nummer i det landet än.");
  }
  return valid.number;
}

/** Counts one text message against the daily limit. */
function countSms(store: Store): void {
  const day = dayKey();
  const count = store.smsUsage?.day === day ? store.smsUsage.count : 0;
  if (count >= smsDailyMax()) {
    throw new AppError(503, "not_configured", "Vi kan inte skicka fler SMS i dag. Försök igen i morgon.");
  }
  store.smsUsage = { day, count: count + 1 };
}

// ---- e-mail codes -----------------------------------------------------------------------------

const CODE_MINUTES = 15;
const CODE_TRIES = 5;

function codeHash(email: string, code: string): string {
  return createHmac("sha256", sessionSecret()).update(`code|${email}|${code}`).digest("base64url");
}

function smsHash(phone: string, code: string): string {
  return createHmac("sha256", sessionSecret()).update(`sms|${phone}|${code}`).digest("base64url");
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

/** Checks a code against its saved hash; a wrong one counts as a try. */
function checkCode(entry: { hash: string; tries: number } | undefined, expectedHash: string, code: string, wrong: string): void {
  if (!entry || entry.tries >= CODE_TRIES) throw new AppError(400, "bad_request", "Koden har gått ut. Be om en ny kod.");
  const expected = Buffer.from(entry.hash);
  const given = Buffer.from(expectedHash);
  if (code.length !== 6 || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    entry.tries += 1;
    throw new AppError(400, "bad_request", wrong);
  }
}

function putEmailCode(store: Store, email: string, code: string, now: number): void {
  store.codes = store.codes.filter((c) => c.email !== email && c.exp > now);
  store.codes.push({ email, hash: codeHash(email, code), exp: now + CODE_MINUTES * 60_000, tries: 0 });
}

function putSmsCode(store: Store, phone: string, code: string, now: number): void {
  countSms(store);
  store.smsCodes = store.smsCodes.filter((c) => c.phone !== phone && c.exp > now);
  store.smsCodes.push({ phone, hash: smsHash(phone, code), exp: now + CODE_MINUTES * 60_000, tries: 0 });
}

/** A code for choosing a new password, or null when no account has this address (nothing is sent then). */
export async function createResetCode(emailInput: unknown): Promise<{ email: string; code: string } | null> {
  const email = normalizeEmail(emailInput);
  if (!EMAIL_RE.test(email)) throw new AppError(400, "bad_request", "Skriv en giltig e-postadress.");
  const code = newCode();
  return withStore((store) => {
    const account = findByEmail(store, email);
    if (!account) return null;
    putEmailCode(store, account.email, code, Date.now());
    return { email: account.email, code };
  });
}

/** Sets a new password with a code from the e-mail, and signs in. */
export async function resetPassword(input: { email: unknown; code: unknown; password: unknown }): Promise<Account> {
  const email = normalizeEmail(input.email);
  const code = digits(input.code);
  const passwordHash = await hashPassword(newPassword(input.password));
  return withStore((store) => {
    const now = Date.now();
    const account = findByEmail(store, email);
    const entry = account && store.codes.find((c) => c.email === account.email && c.exp > now);
    checkCode(entry, codeHash(account?.email ?? email, code), code, "Fel kod. Kolla mejlet och försök igen.");
    store.codes = store.codes.filter((c) => c !== entry);
    account!.passwordHash = passwordHash;
    return account!;
  });
}

// ---- signing up -------------------------------------------------------------------------------

/**
 * First step of a sign-up: checks everything, then returns one code to e-mail and one to text.
 * The account is made only when both come back.
 */
export async function startSignup(input: {
  name: unknown;
  email: unknown;
  phone: unknown;
  password: unknown;
  terms: unknown;
  lang: string;
}): Promise<{ email: string; phone: string; emailCode: string; smsCode: string }> {
  const name = cleanName(input.name);
  if (!name) throw new AppError(400, "bad_request", "Skriv ditt namn.");
  const email = normalizeEmail(input.email);
  checkNewEmail(email);
  const phone = normalizePhone(input.phone, input.lang);
  const passwordHash = await hashPassword(newPassword(input.password));
  termsAccepted(input.terms);
  const emailCode = newCode();
  const smsCode = newCode();
  await withStore((store) => {
    const now = Date.now();
    if (findByEmail(store, email)) {
      throw new AppError(409, "bad_request", "Det finns redan ett konto med den e-postadressen. Logga in i stället.");
    }
    if (phoneTaken(store, phone)) {
      throw new AppError(409, "bad_request", "Det numret hör redan till ett annat konto. Logga in på det i stället.");
    }
    putSmsCode(store, phone, smsCode, now);
    putEmailCode(store, email, emailCode, now);
    store.signups = store.signups.filter((s) => s.email !== email && s.exp > now);
    store.signups.push({ email, name, phone, passwordHash, exp: now + CODE_MINUTES * 60_000 });
  });
  return { email, phone, emailCode, smsCode };
}

/** Second step: both codes are right, so the account is made (with a trial if this person never had one). */
export function finishSignup(input: { email: unknown; emailCode: unknown; smsCode: unknown; origin: Origin }): Promise<Account> {
  const email = normalizeEmail(input.email);
  const emailCode = digits(input.emailCode);
  const smsCode = digits(input.smsCode);
  return withStore((store) => {
    const now = Date.now();
    const pending = store.signups.find((s) => s.email === email && s.exp > now);
    if (!pending) throw new AppError(400, "bad_request", "Koderna har gått ut. Börja om och be om nya koder.");
    const mailEntry = store.codes.find((c) => c.email === email && c.exp > now);
    checkCode(mailEntry, codeHash(email, emailCode), emailCode, "Fel kod från mejlet. Kolla mejlet och försök igen.");
    const smsEntry = store.smsCodes.find((c) => c.phone === pending.phone && c.exp > now);
    checkCode(smsEntry, smsHash(pending.phone, smsCode), smsCode, "Fel kod från SMS:et. Kolla SMS:et och försök igen.");
    store.codes = store.codes.filter((c) => c !== mailEntry);
    store.smsCodes = store.smsCodes.filter((c) => c !== smsEntry);
    store.signups = store.signups.filter((s) => s !== pending);
    if (findByEmail(store, email)) throw new AppError(409, "bad_request", "Det finns redan ett konto med den e-postadressen. Logga in i stället.");
    if (phoneTaken(store, pending.phone)) throw new AppError(409, "bad_request", "Det numret hör redan till ett annat konto.");
    const account = newAccount(store, { email, name: pending.name, origin: input.origin, phone: pending.phone, passwordHash: pending.passwordHash });
    account.termsVersion = TERMS_VERSION;
    account.termsAcceptedAt = new Date(now).toISOString();
    return account;
  });
}

// ---- finishing an account ---------------------------------------------------------------------

/** Texts a code to the number a signed-in account wants to add. */
export async function createPhoneCode(accountId: string, phoneInput: unknown, lang: string): Promise<{ phone: string; code: string }> {
  const phone = normalizePhone(phoneInput, lang);
  const code = newCode();
  await withStore((store) => {
    if (phoneTaken(store, phone, accountId)) {
      throw new AppError(409, "bad_request", "Det numret hör redan till ett annat konto.");
    }
    putSmsCode(store, phone, code, Date.now());
  });
  return { phone, code };
}

/**
 * Adds what an account made before these rules, or with Google/Apple/Microsoft, still lacks: a
 * checked phone number, today's terms and, without Google/Apple/Microsoft, a password. A new
 * account gets its trial here, if this person never had one.
 */
export async function completeAccount(
  accountId: string,
  input: { phone: unknown; smsCode: unknown; terms: unknown; password?: unknown; lang: string; origin: Origin },
): Promise<Account> {
  termsAccepted(input.terms);
  const phone = normalizePhone(input.phone, input.lang);
  const smsCode = digits(input.smsCode);
  const passwordHash = typeof input.password === "string" && input.password ? await hashPassword(newPassword(input.password)) : "";
  return withStore((store) => {
    const now = Date.now();
    const a = store.accounts.find((x) => x.id === accountId);
    if (!a) throw new AppError(401, "unauthorized", "Logga in igen.");
    if (!a.passwordHash && !passwordHash && Object.keys(a.providers ?? {}).length === 0) {
      throw new AppError(400, "bad_request", "Välj ett lösenord.");
    }
    if (a.phone !== phone) {
      const entry = store.smsCodes.find((c) => c.phone === phone && c.exp > now);
      checkCode(entry, smsHash(phone, smsCode), smsCode, "Fel kod från SMS:et. Kolla SMS:et och försök igen.");
      store.smsCodes = store.smsCodes.filter((c) => c !== entry);
      if (phoneTaken(store, phone, a.id)) throw new AppError(409, "bad_request", "Det numret hör redan till ett annat konto.");
      a.phone = phone;
    }
    if (passwordHash) a.passwordHash = passwordHash;
    a.termsVersion = TERMS_VERSION;
    a.termsAcceptedAt = new Date(now).toISOString();
    if (a.trialPending) {
      delete a.trialPending;
      if (!grantTrial(store, a.email, phone, input.origin, now)) a.trialDenied = true;
    } else {
      markPhone(store, phone, now);
    }
    return a;
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
      checkNewEmail(email);
      account = newAccount(store, { email, name: cleanName(input.name), origin: input.origin });
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

function trialSecondsLeft(a: Account): number {
  return a.trialDenied || a.trialPending ? 0 : Math.max(0, TRIAL_SECONDS - a.trialUsedSeconds);
}

/** Free minutes left, and free answers not used up. */
function trialOn(a: Account): boolean {
  return trialSecondsLeft(a) > 0 && a.trialAnswers < TRIAL_MAX_ANSWERS;
}

export interface Access {
  active: boolean;
  reason: AccountReason;
  /** What pays right now: the free minutes first, then the bought balance. */
  plan: Plan;
}

export function accessOf(a: Account): Access {
  if (needsSetup(a)) return { active: false, reason: "setup", plan: a.toppedUp ? "prepaid" : "trial" };
  if (trialOn(a)) return { active: true, reason: "", plan: "trial" };
  if (a.balanceOre > 0) return { active: true, reason: "", plan: "prepaid" };
  return a.toppedUp
    ? { active: false, reason: "empty", plan: "prepaid" }
    : { active: false, reason: "trial_over", plan: "trial" };
}

function dayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Free hours all accounts together may use per day (TRIAL_DAILY_HOURS), so free use has a known daily cost. */
function trialDailySeconds(): number {
  const hours = Number(env("TRIAL_DAILY_HOURS"));
  return (Number.isFinite(hours) && hours > 0 ? hours : 10) * 3600;
}

/** False once today's free minutes are used up; the bought balance is not affected. */
export function trialBudgetOpen(): Promise<boolean> {
  return withStore((store) => {
    const usage = store.trialUsage;
    return !usage || usage.day !== dayKey() || usage.seconds < trialDailySeconds();
  }, false);
}

/** Counts seconds of speech listened to: free minutes first, then the balance. */
export function recordListening(id: string, seconds: number): Promise<Account | null> {
  if (!(seconds > 0)) return getAccount(id);
  return withStore((store) => {
    const a = store.accounts.find((x) => x.id === id);
    if (!a) return null;
    const free = trialOn(a) ? Math.min(trialSecondsLeft(a), seconds) : 0;
    if (free > 0) {
      a.trialUsedSeconds += free;
      const day = dayKey();
      store.trialUsage = { day, seconds: (store.trialUsage?.day === day ? store.trialUsage.seconds : 0) + free };
    }
    a.balanceOre = Math.max(0, a.balanceOre - ((seconds - free) / 60) * LISTEN_ORE_PER_MINUTE);
    return a;
  });
}

/** Counts one answer the user asked for: free in the trial, otherwise ANSWER_ORE from the balance. */
export function recordAnswer(id: string): Promise<Account | null> {
  return withStore((store) => {
    const a = store.accounts.find((x) => x.id === id);
    if (!a) return null;
    if (trialOn(a)) a.trialAnswers += 1;
    else a.balanceOre = Math.max(0, a.balanceOre - ANSWER_ORE);
    return a;
  });
}

/** Adds a paid top-up to the balance. */
export function addBalance(a: Account, ore: number, currency: Currency): void {
  a.balanceOre += ore;
  a.currency ??= currency;
  a.toppedUp = true;
}

export function accountInfo(a: Account): AccountInfo {
  const access = accessOf(a);
  return {
    email: a.email,
    name: a.name,
    plan: access.plan,
    active: access.active,
    reason: access.reason,
    trialSecondsLeft: trialOn(a) ? Math.round(trialSecondsLeft(a)) : 0,
    balanceOre: Math.floor(a.balanceOre),
    currency: a.currency ?? null,
    trialDenied: !!a.trialDenied,
    hasBilling: !!a.stripeCustomerId,
    phone: a.phone ?? "",
    needsPassword: !a.passwordHash && Object.keys(a.providers ?? {}).length === 0,
  };
}

