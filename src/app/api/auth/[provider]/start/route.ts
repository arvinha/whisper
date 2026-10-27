import { accountsEnabled, clientIp, limitAttempts } from "@/lib/server/accounts";
import { appOrigin } from "@/lib/server/billing";
import { AppError } from "@/lib/server/errors";
import { authorizeUrl, parseProvider } from "@/lib/server/oauth";

/** Sends the phone to Google/Apple/Microsoft to sign in. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const origin = appOrigin(req);
  try {
    const provider = parseProvider((await params).provider);
    if (!provider || !accountsEnabled()) throw new AppError(404, "bad_request", "Okänd inloggning.");
    limitAttempts(`oauth:${clientIp(req)}`, 30, 15 * 60_000);
    const device = new URL(req.url).searchParams.get("device") ?? "";
    return Response.redirect(authorizeUrl(provider, origin, /^[A-Za-z0-9_-]{16,64}$/.test(device) ? device : ""), 302);
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Inloggningen kunde inte starta.";
    return Response.redirect(`${origin}/#login_error=${encodeURIComponent(message)}`, 302);
  }
}
