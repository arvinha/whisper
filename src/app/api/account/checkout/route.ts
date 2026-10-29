import { requireFinishedAccount } from "@/lib/server/auth";
import { appOrigin, checkoutUrl, CUSTOM_KIND, customCheckoutUrl, parseCheckoutKind } from "@/lib/server/billing";
import { getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { CUSTOM_TOPUP_MAX, CUSTOM_TOPUP_MIN, customTopUp } from "@/lib/shared/pricing";

export async function POST(req: Request) {
  try {
    const account = await requireFinishedAccount(req, getServerConfig());
    const body = (await req.json().catch(() => null)) as
      | { kind?: unknown; amount?: unknown; currency?: unknown; startNow?: unknown }
      | null;
    if (body?.startNow !== true) {
      throw new AppError(400, "bad_request", "Kryssa i att saldot får börja användas direkt för att fylla på.");
    }
    if (body.kind === CUSTOM_KIND) {
      const kr = customTopUp(body.amount);
      if (!kr) throw new AppError(400, "bad_request", `Välj ett belopp mellan ${CUSTOM_TOPUP_MIN} och ${CUSTOM_TOPUP_MAX} kr.`);
      // The first top-up sets the account's currency; after that every amount is in it.
      const currency = account.currency ?? (body.currency === "dkk" ? "dkk" : "sek");
      return json({ url: await customCheckoutUrl(account, kr, currency, appOrigin(req)) });
    }
    const kind = parseCheckoutKind(body.kind);
    if (!kind) throw new AppError(400, "bad_request", "Okänd påfyllning.");
    return json({ url: await checkoutUrl(account, kind, appOrigin(req)) });
  } catch (err) {
    return errorResponse(err);
  }
}
