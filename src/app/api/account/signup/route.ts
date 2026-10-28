import { accountsEnabled, clientIp, limitAttempts, normalizeEmail, startSignup } from "@/lib/server/accounts";
import { appOrigin } from "@/lib/server/billing";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { mailEnabled, mailLang, sendCodeMail } from "@/lib/server/mail";
import { sendCodeSms, smsEnabled } from "@/lib/server/sms";

/**
 * Sign-up, first step: checks name, e-mail, password, terms and (while texts are on) the mobile
 * number, then sends a code by e-mail and, with a number, one by text.
 */
export async function POST(req: Request) {
  try {
    if (!accountsEnabled() || !mailEnabled()) {
      throw new AppError(503, "not_configured", "Det går inte att skapa konto här just nu.");
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const lang = mailLang(body?.lang);
    limitAttempts(`signup:${clientIp(req)}`, 5, 60 * 60_000);
    limitAttempts(`signup:${normalizeEmail(body?.email)}`, 3, 60 * 60_000);
    const sent = await startSignup({
      name: body?.name,
      email: body?.email,
      phone: body?.phone,
      password: body?.password,
      terms: body?.terms,
      lang,
    });
    if (sent.phone && smsEnabled()) {
      limitAttempts(`sms:${sent.phone}`, 3, 60 * 60_000);
      await sendCodeSms(sent.phone, sent.smsCode, lang, new URL(appOrigin(req)).host);
    }
    await sendCodeMail(sent.email, sent.emailCode, "login", lang);
    return json({ ok: true, phone: sent.phone });
  } catch (err) {
    return errorResponse(err);
  }
}
