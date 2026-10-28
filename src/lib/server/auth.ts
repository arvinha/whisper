import { createHash, timingSafeEqual } from "node:crypto";
import { accessOf, accountsEnabled, getAccount, readToken, trialBudgetOpen, type Account } from "./accounts";
import type { ServerConfig } from "./config";
import { AppError } from "./errors";

export const PASSWORD_HEADER = "x-psst-password";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function same(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** Who sent a request. Family codes and the main password have no account and no limits. */
export interface Caller {
  name: string;
  account: Account | null;
}

export function authRequired(config: ServerConfig): boolean {
  return config.password !== "" || config.users.length > 0 || accountsEnabled();
}

function givenSecret(req: Request): string {
  const raw = req.headers.get(PASSWORD_HEADER) ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The caller, or null if the code, password or session is wrong or missing. Main password → name
 * "", personal code from APP_USERS → that person's name, account session → the account.
 */
export async function authorizedCaller(req: Request, config: ServerConfig): Promise<Caller | null> {
  if (!authRequired(config)) return { name: "", account: null };
  const given = givenSecret(req);
  if (!given) return null;

  const accountId = readToken(given);
  if (accountId) {
    const account = await getAccount(accountId);
    return account ? { name: account.name || account.email, account } : null;
  }

  let user: string | null = config.password && same(given, config.password) ? "" : null;
  const loose = given.trim().toLowerCase();
  for (const u of config.users) {
    if (same(loose, u.code.toLowerCase()) && user === null) user = u.name;
  }
  return user === null ? null : { name: user, account: null };
}

export async function requireAuth(req: Request, config: ServerConfig): Promise<Caller> {
  const caller = await authorizedCaller(req, config);
  if (!caller) {
    throw new AppError(401, "unauthorized", "Fel eller saknad kod.");
  }
  return caller;
}

/** Like requireAuth, but an account must also have free minutes or balance left. */
export async function requireAccess(req: Request, config: ServerConfig): Promise<Caller> {
  const caller = await requireAuth(req, config);
  if (caller.account) {
    const access = accessOf(caller.account);
    if (access.reason === "setup") throw setupError();
    if (!access.active) {
      throw new AppError(402, "plan_required", "Fyll på saldot för att fortsätta använda Whisper.");
    }
    if (access.plan === "trial" && !(await trialBudgetOpen())) {
      throw new AppError(429, "trial_busy", "Dagens gratisminuter är slut. Försök igen i morgon eller fyll på saldot.");
    }
  }
  return caller;
}

function setupError(): AppError {
  return new AppError(402, "plan_required", "Slutför ditt konto först: lägg till ditt mobilnummer och godkänn villkoren.");
}

export async function requireAccount(req: Request, config: ServerConfig): Promise<Account> {
  const caller = await requireAuth(req, config);
  if (!caller.account) throw new AppError(400, "bad_request", "Logga in med ett konto först.");
  return caller.account;
}

/** Like requireAccount, but the account must be finished (phone, terms, a way to log in). */
export async function requireFinishedAccount(req: Request, config: ServerConfig): Promise<Account> {
  const account = await requireAccount(req, config);
  if (accessOf(account).reason === "setup") throw setupError();
  return account;
}
