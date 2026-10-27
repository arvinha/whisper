import { requireAccount } from "@/lib/server/auth";
import { appOrigin, checkoutUrl, parseCheckoutKind } from "@/lib/server/billing";
import { getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, json } from "@/lib/server/errors";

export async function POST(req: Request) {
  try {
    const account = await requireAccount(req, getServerConfig());
    const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
    const kind = parseCheckoutKind(body?.kind);
    if (!kind) throw new AppError(400, "bad_request", "Okänt abonnemang.");
    return json({ url: await checkoutUrl(account, kind, appOrigin(req)) });
  } catch (err) {
    return errorResponse(err);
  }
}
