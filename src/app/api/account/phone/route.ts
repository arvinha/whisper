import { clientIp, createPhoneCode, limitAttempts } from "@/lib/server/accounts";
import { requireAccount } from "@/lib/server/auth";
import { appOrigin } from "@/lib/server/billing";
import { getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { mailLang } from "@/lib/server/mail";
import { sendCodeSms, smsEnabled } from "@/lib/server/sms";

/** Texts a code to the mobile number a signed-in account wants to add. */
export async function POST(req: Request) {
  try {
    const account = await requireAccount(req, getServerConfig());
    if (!smsEnabled()) throw new AppError(503, "not_configured", "SMS är inte igång än.");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const lang = mailLang(body?.lang);
    limitAttempts(`phone:${clientIp(req)}`, 10, 60 * 60_000);
    limitAttempts(`phone:${account.id}`, 5, 60 * 60_000);
    const sent = await createPhoneCode(account.id, body?.phone, lang);
    limitAttempts(`sms:${sent.phone}`, 3, 60 * 60_000);
    await sendCodeSms(sent.phone, sent.code, lang, new URL(appOrigin(req)).host);
    return json({ ok: true, phone: sent.phone });
  } catch (err) {
    return errorResponse(err);
  }
}
