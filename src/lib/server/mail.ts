import { AppError } from "./errors";

type Lang = "sv" | "da" | "en";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** E-mail goes through Resend (resend.com) from a verified domain. */
export function mailEnabled(): boolean {
  return env("RESEND_API_KEY").startsWith("re_") && env("MAIL_FROM").includes("@");
}

export function mailLang(value: unknown): Lang {
  return value === "da" || value === "en" ? value : "sv";
}

const CODE_TEXT: Record<Lang, { subject: (code: string) => string; intro: string; reset: string; ignore: string }> = {
  sv: {
    subject: (code) => `${code} är din kod till Whisper`,
    intro: "Skriv in den här koden i Whisper för att fortsätta:",
    reset: "Skriv in den här koden i Whisper och välj ett nytt lösenord:",
    ignore: "Koden gäller i 15 minuter. Har du inte bett om den kan du strunta i det här mejlet.",
  },
  da: {
    subject: (code) => `${code} er din kode til Whisper`,
    intro: "Skriv denne kode i Whisper for at fortsætte:",
    reset: "Skriv denne kode i Whisper, og vælg en ny adgangskode:",
    ignore: "Koden gælder i 15 minutter. Har du ikke bedt om den, kan du se bort fra denne mail.",
  },
  en: {
    subject: (code) => `${code} is your Whisper code`,
    intro: "Enter this code in Whisper to continue:",
    reset: "Enter this code in Whisper and choose a new password:",
    ignore: "The code is valid for 15 minutes. If you did not ask for it, you can ignore this email.",
  },
};

export async function sendCodeMail(to: string, code: string, purpose: "login" | "reset", lang: Lang): Promise<void> {
  if (!mailEnabled()) throw new AppError(503, "not_configured", "E-post är inte igång än.");
  const t = CODE_TEXT[lang];
  const lead = purpose === "reset" ? t.reset : t.intro;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#18181b">` +
    `<p style="font-size:20px;font-weight:600;margin:0 0 16px">whis<span style="color:#7c3aed">per</span></p>` +
    `<p style="font-size:15px;line-height:1.5;margin:0 0 16px">${lead}</p>` +
    `<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 16px">${code}</p>` +
    `<p style="font-size:13px;line-height:1.5;color:#71717a;margin:0">${t.ignore}</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env("RESEND_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("MAIL_FROM"),
      to: [to],
      subject: t.subject(code),
      html,
      text: `${lead}\n\n${code}\n\n${t.ignore}`,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) {
    console.error("[whisper] mail failed", res?.status, await res?.text().catch(() => ""));
    throw new AppError(502, "provider_error", "Mejlet kunde inte skickas. Försök igen om en stund.");
  }
}
