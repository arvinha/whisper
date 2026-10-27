import { accountsEnabled, clientIp, limitAttempts, login, makeToken, normalizeEmail } from "@/lib/server/accounts";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import type { AuthResult } from "@/lib/shared/types";

export async function POST(req: Request) {
  try {
    if (!accountsEnabled()) throw new AppError(503, "not_configured", "Inloggning med konto är inte igång här.");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    limitAttempts(`login:${clientIp(req)}`, 20, 15 * 60_000);
    limitAttempts(`login:${normalizeEmail(body?.email)}`, 10, 15 * 60_000);
    const account = await login(body?.email, body?.password);
    return json({ token: makeToken(account.id) } satisfies AuthResult);
  } catch (err) {
    return errorResponse(err);
  }
}
