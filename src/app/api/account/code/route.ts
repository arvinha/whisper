import { accountsEnabled, clientIp, createResetCode, limitAttempts, normalizeEmail } from "@/lib/server/accounts";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { mailEnabled, mailLang, sendCodeMail } from "@/lib/server/mail";

/** E-mails a six-digit code for choosing a new password. Says ok even when no account has the address. */
export async function POST(req: Request) {
  try {
    if (!accountsEnabled() || !mailEnabled()) throw new AppError(503, "not_configured", "Inloggning med e-post är inte igång här.");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    limitAttempts(`code:${clientIp(req)}`, 10, 60 * 60_000);
    limitAttempts(`code:${normalizeEmail(body?.email)}`, 5, 60 * 60_000);
    const sent = await createResetCode(body?.email);
    if (sent) await sendCodeMail(sent.email, sent.code, "reset", mailLang(body?.lang));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
