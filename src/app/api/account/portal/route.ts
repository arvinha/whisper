import { requireAccount } from "@/lib/server/auth";
import { appOrigin, portalUrl } from "@/lib/server/billing";
import { getServerConfig } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/errors";

export async function POST(req: Request) {
  try {
    const account = await requireAccount(req, getServerConfig());
    return json({ url: await portalUrl(account, appOrigin(req)) });
  } catch (err) {
    return errorResponse(err);
  }
}
