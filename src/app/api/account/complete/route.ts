import { accountInfo, clientIp, completeAccount, limitAttempts, originOf } from "@/lib/server/accounts";
import { requireAccount } from "@/lib/server/auth";
import { getServerConfig } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/errors";
import { mailLang } from "@/lib/server/mail";

/** Finishes an account: the texted code, the terms and, when needed, a password. */
export async function POST(req: Request) {
  try {
    const caller = await requireAccount(req, getServerConfig());
    limitAttempts(`verify:${clientIp(req)}`, 30, 15 * 60_000);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const account = await completeAccount(caller.id, {
      phone: body?.phone,
      smsCode: body?.smsCode,
      terms: body?.terms,
      password: body?.password,
      lang: mailLang(body?.lang),
      origin: originOf(req, body?.device),
    });
    return json({ account: accountInfo(account) });
  } catch (err) {
    return errorResponse(err);
  }
}
