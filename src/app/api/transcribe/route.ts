import { recordUsage } from "@/lib/server/accounts";
import { requireAccess } from "@/lib/server/auth";
import { getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, json, requestSignal } from "@/lib/server/errors";
import { transcribeAudio } from "@/lib/server/stt";
import { parseLanguageCode } from "@/lib/server/validate";
import type { TranscribeResult } from "@/lib/shared/types";

export const maxDuration = 30;

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const WAV_HEADER_BYTES = 44;

/** Seconds of audio in a WAV clip, read from the header's byte rate (16 kHz mono 16-bit if unclear). */
async function wavSeconds(audio: Blob): Promise<number> {
  const header = new DataView(await audio.slice(0, WAV_HEADER_BYTES).arrayBuffer());
  const byteRate = header.byteLength >= 32 ? header.getUint32(28, true) : 0;
  const rate = byteRate > 1000 && byteRate < 1_000_000 ? byteRate : 32_000;
  return Math.max(0, audio.size - WAV_HEADER_BYTES) / rate;
}

export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    const caller = await requireAccess(req, config);
    if (!config.stt) {
      throw new AppError(503, "not_configured", config.problems.join(" ") || "Taligenkänning saknas.");
    }

    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      throw new AppError(400, "bad_request", "Ljudfil saknas.");
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new AppError(413, "bad_request", "Ljudfilen är för stor.");
    }
    const prompt = form?.get("prompt");

    const started = Date.now();
    const text = await transcribeAudio(config.stt, audio, {
      language: parseLanguageCode(form?.get("language")),
      prompt: typeof prompt === "string" ? prompt : undefined,
      signal: requestSignal(req, 25_000),
    });
    if (caller.account) await recordUsage(caller.account.id, await wavSeconds(audio));
    return json({ text, ms: Date.now() - started } satisfies TranscribeResult);
  } catch (err) {
    return errorResponse(err);
  }
}
