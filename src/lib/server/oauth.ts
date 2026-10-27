import { createHmac, createPrivateKey, randomBytes, sign, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AuthProvider } from "@/lib/shared/types";
import { accountsEnabled } from "./accounts";
import { AppError } from "./errors";

/**
 * "Continue with Google/Apple/Microsoft/Facebook" (authorization code flow). The ID token
 * comes straight from the provider's token endpoint over TLS with our client secret, so its
 * signature does not need checking (OpenID Connect Core 3.1.3.7).
 */

interface ProviderSpec {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  /** Apple posts the answer back as a form. */
  formPost: boolean;
  clientId: () => string;
  clientSecret: () => string;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function applePrivateKey(): string {
  const inline = env("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (inline) return inline;
  const file = env("APPLE_PRIVATE_KEY_FILE");
  if (!file) return "";
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Apple wants a short-lived ES256 token signed with the .p8 key instead of a fixed secret. */
function appleClientSecret(): string {
  const key = applePrivateKey();
  if (!key || !env("APPLE_TEAM_ID") || !env("APPLE_KEY_ID")) return "";
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "ES256", kid: env("APPLE_KEY_ID") })}.${part({
    iss: env("APPLE_TEAM_ID"),
    iat: now,
    exp: now + 300,
    aud: "https://appleid.apple.com",
    sub: env("APPLE_CLIENT_ID"),
  })}`;
  const signature = sign("sha256", Buffer.from(body), { key: createPrivateKey(key), dsaEncoding: "ieee-p1363" });
  return `${body}.${signature.toString("base64url")}`;
}

const FACEBOOK_API = "v21.0";

const PROVIDERS: Record<AuthProvider, ProviderSpec> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    formPost: false,
    clientId: () => env("GOOGLE_CLIENT_ID"),
    clientSecret: () => env("GOOGLE_CLIENT_SECRET"),
  },
  apple: {
    authUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    scope: "name email",
    formPost: true,
    clientId: () => env("APPLE_CLIENT_ID"),
    clientSecret: appleClientSecret,
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email profile",
    formPost: false,
    clientId: () => env("MICROSOFT_CLIENT_ID"),
    clientSecret: () => env("MICROSOFT_CLIENT_SECRET"),
  },
  facebook: {
    authUrl: `https://www.facebook.com/${FACEBOOK_API}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${FACEBOOK_API}/oauth/access_token`,
    scope: "public_profile,email",
    formPost: false,
    clientId: () => env("FACEBOOK_APP_ID"),
    clientSecret: () => env("FACEBOOK_APP_SECRET"),
  },
};

export function parseProvider(value: unknown): AuthProvider | null {
  return typeof value === "string" && value in PROVIDERS ? (value as AuthProvider) : null;
}

function configured(provider: AuthProvider): boolean {
  const spec = PROVIDERS[provider];
  if (!spec.clientId()) return false;
  return provider === "apple" ? !!applePrivateKey() && !!env("APPLE_TEAM_ID") && !!env("APPLE_KEY_ID") : !!spec.clientSecret();
}

/** The sign-in buttons to show, in this order. */
export function enabledProviders(): AuthProvider[] {
  if (!accountsEnabled()) return [];
  return (["apple", "google", "facebook", "microsoft"] as const).filter(configured);
}

// ---- state: proves the answer belongs to a sign-in we started, and carries the phone's id ----

const STATE_MINUTES = 15;

function stateSign(payload: string): string {
  return createHmac("sha256", env("SESSION_SECRET")).update(`oauth|${payload}`).digest("base64url");
}

function makeState(provider: AuthProvider, device: string): string {
  const payload = [provider, device || "-", Date.now() + STATE_MINUTES * 60_000, randomBytes(8).toString("base64url")].join(".");
  return `${payload}.${stateSign(payload)}`;
}

function readState(provider: AuthProvider, state: string): { device: string } {
  const parts = state.split(".");
  const sig = parts.pop() ?? "";
  const payload = parts.join(".");
  const expected = Buffer.from(stateSign(payload));
  const given = Buffer.from(sig);
  const [p, device, exp] = parts;
  if (expected.length !== given.length || !timingSafeEqual(expected, given) || p !== provider || Number(exp) < Date.now()) {
    throw new AppError(400, "bad_request", "Inloggningen tog för lång tid. Försök igen.");
  }
  return { device: device === "-" ? "" : device };
}

// ---- the flow ---------------------------------------------------------------------------------

function redirectUri(origin: string, provider: AuthProvider): string {
  return `${origin}/api/auth/${provider}/callback`;
}

export function authorizeUrl(provider: AuthProvider, origin: string, device: string): string {
  if (!configured(provider)) throw new AppError(503, "not_configured", "Den inloggningen är inte igång än.");
  const spec = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: spec.clientId(),
    redirect_uri: redirectUri(origin, provider),
    response_type: "code",
    scope: spec.scope,
    state: makeState(provider, device),
  });
  if (spec.formPost) params.set("response_mode", "form_post");
  if (provider === "google") params.set("prompt", "select_account");
  if (provider === "microsoft") params.set("prompt", "select_account");
  return `${spec.authUrl}?${params}`;
}

export interface ProviderIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  device: string;
}

function decodeIdToken(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Facebook has no ID token in the web flow, so we ask the Graph API who the token belongs to.
 * The token is tied to our app id and secret (appsecret_proof). Facebook only returns confirmed
 * addresses, so the e-mail counts as verified.
 */
async function facebookIdentity(accessToken: string): Promise<Omit<ProviderIdentity, "device">> {
  const proof = createHmac("sha256", env("FACEBOOK_APP_SECRET")).update(accessToken).digest("hex");
  const params = new URLSearchParams({ fields: "id,first_name,email", access_token: accessToken, appsecret_proof: proof });
  const res = await fetch(`https://graph.facebook.com/${FACEBOOK_API}/me?${params}`, {
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const me = (await res?.json().catch(() => ({}))) as { id?: string; first_name?: string; email?: string } | undefined;
  if (!res?.ok || !me?.id) {
    console.error("[whisper] facebook profile failed", res?.status);
    throw new AppError(502, "provider_error", "Inloggningen misslyckades. Försök igen.");
  }
  return { subject: me.id, email: me.email ?? "", emailVerified: Boolean(me.email), name: me.first_name ?? "" };
}

/** Swaps the code from the provider for who the user is. `user` is Apple's first-time name. */
export async function finishSignIn(
  provider: AuthProvider,
  origin: string,
  input: { code: string; state: string; user?: string },
): Promise<ProviderIdentity> {
  const { device } = readState(provider, input.state);
  if (!input.code) throw new AppError(400, "bad_request", "Inloggningen avbröts.");
  const spec = PROVIDERS[provider];
  const res = await fetch(spec.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri(origin, provider),
      client_id: spec.clientId(),
      client_secret: spec.clientSecret(),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const data = (await res?.json().catch(() => ({}))) as
    | { id_token?: string; access_token?: string; error?: string | { message?: string } }
    | undefined;
  if (provider === "facebook") {
    if (!res?.ok || !data?.access_token) {
      console.error("[whisper] oauth token failed", provider, res?.status, data?.error);
      throw new AppError(502, "provider_error", "Inloggningen misslyckades. Försök igen.");
    }
    return { ...(await facebookIdentity(data.access_token)), device };
  }
  if (!res?.ok || !data?.id_token) {
    console.error("[whisper] oauth token failed", provider, res?.status, data?.error);
    throw new AppError(502, "provider_error", "Inloggningen misslyckades. Försök igen.");
  }
  const claims = decodeIdToken(data.id_token);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  let name = str(claims.given_name) || str(claims.name);
  if (provider === "apple" && input.user) {
    try {
      const user = JSON.parse(input.user) as { name?: { firstName?: string } };
      name = user.name?.firstName ?? name;
    } catch {
      // no name
    }
  }
  const email = str(claims.email) || (provider === "microsoft" ? str(claims.preferred_username) : "");
  const verified = claims.email_verified;
  return {
    subject: str(claims.sub),
    email,
    // Apple sends the flag as a string; Microsoft does not send it for personal accounts.
    emailVerified: verified === true || verified === "true" || provider === "microsoft",
    name: name.split(" ")[0] ?? "",
    device,
  };
}
