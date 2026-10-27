import { generateAnswer } from "@/lib/server/answer";
import { requireAuth } from "@/lib/server/auth";
import { getServerConfig } from "@/lib/server/config";
import { AppError, errorResponse, json } from "@/lib/server/errors";
import { transcribeAudio } from "@/lib/server/stt";
import { synthesizeSpeech } from "@/lib/server/tts";
import type { SelfTestItem, SelfTestResult } from "@/lib/shared/types";

export const maxDuration = 60;

/** One second of a quiet 220 Hz tone as 16 kHz mono WAV. */
function testWav(): Blob {
  const rate = 16000;
  const samples = rate;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 1500), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function measure(run: () => Promise<string>): Promise<SelfTestItem> {
  const started = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, ms: Date.now() - started, detail };
  }
}

export async function POST(req: Request) {
  try {
    const config = getServerConfig();
    await requireAuth(req, config);
    const { stt, llm, tts } = config;

    const [sttResult, llmResult, ttsResult] = await Promise.all([
      measure(async () => {
        if (!stt) throw new AppError(503, "not_configured", "Ingen taligenkänning konfigurerad.");
        await transcribeAudio(stt, testWav(), { signal: AbortSignal.timeout(20_000) });
        return `${stt.provider} · ${stt.model}`;
      }),
      measure(async () => {
        if (!llm) throw new AppError(503, "not_configured", "Ingen svarsmodell konfigurerad.");
        const result = await generateAnswer(
          llm,
          {
            mode: "short",
            transcript: [{ secondsAgo: 2, text: "Vad är huvudstaden i Danmark?" }],
            profile: "",
            style: "smart",
            language: "sv",
          },
          AbortSignal.timeout(25_000),
        );
        if (!result.answer) throw new Error("Modellen svarade, men utan text.");
        return `${llm.provider} · ${llm.model}: "${result.answer}"`;
      }),
      tts
        ? measure(async () => {
            const res = await synthesizeSpeech(tts, "Hej!", "sv", AbortSignal.timeout(20_000));
            const bytes = (await res.arrayBuffer()).byteLength;
            if (bytes === 0) throw new Error("Tomt ljud.");
            return `${tts.provider === "azure" ? "Azure" : "OpenAI"} · ${tts.voice}`;
          })
        : Promise.resolve(null),
    ]);

    return json({ stt: sttResult, llm: llmResult, tts: ttsResult } satisfies SelfTestResult);
  } catch (err) {
    return errorResponse(err);
  }
}
