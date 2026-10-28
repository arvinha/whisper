import { accountsEnabled, clientIp, limitAttempts, makeToken, resetPassword } from "@/lib/server/accounts";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import type { AuthResult } from "@/lib/shared/types";

/** Checks the e-mailed code, sets the new password and signs in. */
export async function POST(req: Request) {
  try {
    if (!accountsEnabled()) throw new AppError(503, "not_configured", "Inloggning med konto är inte igång här.");
    limitAttempts(`verify:${clientIp(req)}`, 30, 15 * 60_000);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const account = await resetPassword({ email: body?.email, code: body?.code, password: body?.password });
    return json({ token: makeToken(account.id) } satisfies AuthResult);
  } catch (err) {
    return errorResponse(err);
  }
}
