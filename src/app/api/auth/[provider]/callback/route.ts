import { makeToken, originOf, signInWithProvider } from "@/lib/server/accounts";
import { appOrigin } from "@/lib/server/billing";
import { AppError } from "@/lib/server/errors";
import { finishSignIn, parseProvider } from "@/lib/server/oauth";

type Context = { params: Promise<{ provider: string }> };

/** Back from Google/Microsoft (GET) or Apple (form POST): sign in and hand the session to the app. */
async function handle(req: Request, ctx: Context, fields: URLSearchParams | FormData) {
  const origin = appOrigin(req);
  const field = (name: string) => {
    const value = fields.get(name);
    return typeof value === "string" ? value : "";
  };
  try {
    const provider = parseProvider((await ctx.params).provider);
    if (!provider) throw new AppError(404, "bad_request", "Okänd inloggning.");
    if (field("error")) throw new AppError(400, "bad_request", "Inloggningen avbröts.");
    const who = await finishSignIn(provider, origin, { code: field("code"), state: field("state"), user: field("user") });
    const account = await signInWithProvider({ provider, ...who, origin: originOf(req, who.device) });
    // The token goes in the fragment, which browsers never send to a server or put in logs.
    return Response.redirect(`${origin}/#login=${encodeURIComponent(makeToken(account.id))}`, 303);
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Inloggningen misslyckades. Försök igen.";
    if (!(err instanceof AppError)) console.error("[whisper] oauth", err);
    return Response.redirect(`${origin}/#login_error=${encodeURIComponent(message)}`, 303);
  }
}

export async function GET(req: Request, ctx: Context) {
  return handle(req, ctx, new URL(req.url).searchParams);
}

export async function POST(req: Request, ctx: Context) {
  return handle(req, ctx, await req.formData().catch(() => new FormData()));
}
