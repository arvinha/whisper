import { requireAccess } from "@/lib/server/auth";
import { getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, requestSignal } from "@/lib/server/errors";
import { synthesizeSpeech } from "@/lib/server/tts";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    await requireAccess(req, config);
    if (!config.tts) {
      throw new AppError(503, "not_configured", "Molnröst kräver AZURE_SPEECH_KEY eller OPENAI_API_KEY.");
    }
    const body = (await req.json().catch(() => null)) as { text?: unknown; lang?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 1500) : "";
    if (!text) throw new AppError(400, "bad_request", "Text saknas.");
    const lang = typeof body?.lang === "string" ? body.lang.slice(0, 2) : "sv";

    const upstream = await synthesizeSpeech(config.tts, text, lang, requestSignal(req, 25_000));
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
