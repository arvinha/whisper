import { generateAnswer } from "@/lib/server/answer";
import { requireAccess } from "@/lib/server/auth";
import { getDeepConfig, getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, json, requestSignal } from "@/lib/server/errors";
import { parseAnswerRequest } from "@/lib/server/validate";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    await requireAccess(req, config);
    if (!config.llm) {
      throw new AppError(503, "not_configured", config.problems.join(" ") || "Svarsmodell saknas.");
    }
    const body: unknown = await req.json().catch(() => null);
    const request = parseAnswerRequest(body);
    const deep = request.mode === "deep";
    // Without material, the stronger model has nothing to dig through; the fast one reads the search results.
    // The stronger model reads the material and the web well; without either, the fast one is enough.
    const llm = (deep && (request.context || request.live) ? getDeepConfig(config) : null) ?? config.llm;
    const country = (req.headers.get("cf-ipcountry") ?? "").toUpperCase();
    const result = await generateAnswer(
      llm,
      request,
      requestSignal(req, deep ? 50_000 : 25_000),
      /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : undefined,
    );
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
