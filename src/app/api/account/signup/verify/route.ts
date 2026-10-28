import { accountsEnabled, clientIp, finishSignup, limitAttempts, makeToken, originOf } from "@/lib/server/accounts";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import type { AuthResult } from "@/lib/shared/types";

/** Sign-up, second step: both codes are right, so the account is made and signed in. */
export async function POST(req: Request) {
  try {
    if (!accountsEnabled()) throw new AppError(503, "not_configured", "Inloggning med konto är inte igång här.");
    limitAttempts(`verify:${clientIp(req)}`, 30, 15 * 60_000);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const account = await finishSignup({
      email: body?.email,
      emailCode: body?.emailCode,
      smsCode: body?.smsCode,
      origin: originOf(req, body?.device),
    });
    return json({ token: makeToken(account.id) } satisfies AuthResult);
  } catch (err) {
    return errorResponse(err);
  }
}
