import { promises as fs } from "node:fs";
import { AppError } from "./errors";

type Lang = "sv" | "da" | "en";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** Writes texts to a file instead of sending them; only outside production, for tests. */
function fakeFile(): string {
  return process.env.NODE_ENV === "production" ? "" : env("SMS_FAKE_FILE");
}

/** Texts go through 46elks (46elks.com). */
export function smsEnabled(): boolean {
  return (!!env("ELKS_API_USERNAME") && !!env("ELKS_API_PASSWORD")) || !!fakeFile();
}

/** Countries a code may be texted to (SMS_COUNTRIES), so nobody can run up bills on expensive foreign numbers. */
export function smsCountries(): string[] {
  const list = env("SMS_COUNTRIES")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length > 0 ? list : ["SE", "DK", "NO", "FI"];
}

/** Texts all accounts together may cause per day (SMS_DAILY_MAX), so a bot cannot run up the bill. */
export function smsDailyMax(): number {
  const max = Number(env("SMS_DAILY_MAX"));
  return Number.isFinite(max) && max > 0 ? max : 300;
}

const CODE_TEXT: Record<Lang, (code: string) => string> = {
  sv: (code) => `${code} är din kod till Whisper. Den gäller i 15 minuter.`,
  da: (code) => `${code} er din kode til Whisper. Den gælder i 15 minutter.`,
  en: (code) => `${code} is your Whisper code. It is valid for 15 minutes.`,
};

/** Texts a six-digit code. The last line lets phones fill it in by themselves (WebOTP). */
export async function sendCodeSms(to: string, code: string, lang: Lang, host: string): Promise<void> {
  const message = `${CODE_TEXT[lang](code)}\n\n@${host} #${code}`;
  const fake = fakeFile();
  if (fake) {
    await fs.appendFile(fake, `${JSON.stringify({ to, code, message })}\n`);
    return;
  }
  if (!smsEnabled()) throw new AppError(503, "not_configured", "SMS är inte igång än.");
  const auth = Buffer.from(`${env("ELKS_API_USERNAME")}:${env("ELKS_API_PASSWORD")}`).toString("base64");
  const res = await fetch("https://api.46elks.com/a1/sms", {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ from: env("SMS_FROM") || "Whisper", to, message }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error("[whisper] sms failed", res?.status, await res?.text().catch(() => ""));
    throw new AppError(502, "provider_error", "SMS:et kunde inte skickas. Kolla numret och försök igen om en stund.");
  }
}
