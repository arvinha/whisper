import { accountsEnabled, clientIp, createCode, limitAttempts, normalizeEmail } from "@/lib/server/accounts";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { mailEnabled, mailLang, sendCodeMail } from "@/lib/server/mail";

/** Sends a six-digit code by e-mail, for signing up, logging in or a forgotten password. */
export async function POST(req: Request) {
  try {
    if (!accountsEnabled() || !mailEnabled()) throw new AppError(503, "not_configured", "Inloggning med e-post är inte igång här.");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    limitAttempts(`code:${clientIp(req)}`, 10, 60 * 60_000);
    limitAttempts(`code:${normalizeEmail(body?.email)}`, 5, 60 * 60_000);
    const { email, code } = await createCode(body?.email);
    await sendCodeMail(email, code, body?.purpose === "reset" ? "reset" : "login", mailLang(body?.lang));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
