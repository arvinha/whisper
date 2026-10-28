import { accountInfo, recordAnswer } from "@/lib/server/accounts";
import { requireAuth } from "@/lib/server/auth";
import { getServerConfig } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/errors";

/** Called once for each answer the user asked for and got; charges it to the account. */
export async function POST(req: Request) {
  try {
    const caller = await requireAuth(req, getServerConfig());
    if (!caller.account) return json({ account: null });
    const account = await recordAnswer(caller.account.id);
    return json({ account: account ? accountInfo(account) : null });
  } catch (err) {
    return errorResponse(err);
  }
}
