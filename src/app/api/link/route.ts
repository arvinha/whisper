import { requireAccess } from "@/lib/server/auth";
import { getServerConfig, getVisionConfig } from "@/lib/server/config";
import { errorResponse, json, requestSignal } from "@/lib/server/errors";
import { readLink } from "@/lib/server/web";

export const maxDuration = 90;

/** Reads a job ad, a company site or GitHub projects behind a link. Nothing is stored. */
export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    await requireAccess(req, config);
    const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url : "";
    return json(await readLink(url, getVisionConfig(config), requestSignal(req, 85_000)));
  } catch (err) {
    return errorResponse(err);
  }
}
