import { requireAccess } from "@/lib/server/auth";
import { getServerConfig, isFrugal } from "@/lib/server/config";
import { AppError, errorResponse, json, requestSignal } from "@/lib/server/errors";
import { generateBrief } from "@/lib/server/prepare";
import { parsePrepareRequest } from "@/lib/server/validate";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    await requireAccess(req, config);
    if (!config.llm) {
      throw new AppError(503, "not_configured", config.problems.join(" ") || "Svarsmodell saknas.");
    }
    const body: unknown = await req.json().catch(() => null);
    const request = parsePrepareRequest(body);
    const result = await generateBrief(config.llm, request, {
      frugal: isFrugal(config.llm),
      signal: requestSignal(req, 110_000),
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
