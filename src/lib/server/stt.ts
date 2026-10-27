import type { LanguageCode } from "@/lib/shared/types";
import { PROVIDER_LABEL, type SttConfig } from "./config";
import { AppError, providerFetch } from "./errors";

export interface TranscribeOptions {
  language?: LanguageCode;
  prompt?: string;
  signal: AbortSignal;
}

const MOCK_LINES = [
  "Vi var i Japan i somras, det var helt otroligt.",
  "Vet du förresten varför himlen är blå?",
  "Jag läste att det byggs ett nytt kärnkraftverk i Sverige.",
  "Hur fungerar egentligen AI som ChatGPT?",
  "Vilken är världens största öken, tror du?",
];
let mockIndex = 0;

/** Models that rejected our optional fields; they get only file + model from then on. */
const minimalModels = new Set<string>();
const OPTIONAL_FIELDS = /prompt|language|temperature|response_format/i;

/** gpt-transcribe takes a `languages` array; older OpenAI models and Whisper take `language`. */
function usesLanguagesArray(model: string): boolean {
  const m = model.toLowerCase();
  return !(m.startsWith("whisper") || m.startsWith("gpt-4o"));
}

function buildForm(cfg: SttConfig, audio: Blob, opts: TranscribeOptions, minimal: boolean): FormData {
  const form = new FormData();
  form.append("file", audio, "segment.wav");
  form.append("model", cfg.model);
  if (minimal) return form;

  const prompt = opts.prompt?.replace(/[\r\n<>]+/g, " ").trim().slice(-200);
  if (prompt) form.append("prompt", prompt);
  if (cfg.provider === "groq") {
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (opts.language) form.append("language", opts.language);
  } else if (opts.language) {
    form.append(usesLanguagesArray(cfg.model) ? "languages[]" : "language", opts.language);
  }
  return form;
}

export async function transcribeAudio(
  cfg: SttConfig,
  audio: Blob,
  opts: TranscribeOptions,
): Promise<string> {
  if (cfg.provider === "mock") {
    await new Promise((r) => setTimeout(r, 300));
    return MOCK_LINES[mockIndex++ % MOCK_LINES.length];
  }

  const label = PROVIDER_LABEL[cfg.provider];
  const key = `${cfg.provider}:${cfg.model}`;
  const send = (minimal: boolean) =>
    providerFetch(label, `${cfg.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: buildForm(cfg, audio, opts, minimal),
      signal: opts.signal,
    });

  let res: Response;
  try {
    res = await send(minimalModels.has(key));
  } catch (err) {
    if (!(err instanceof AppError) || err.extra.upstreamStatus !== 400 || minimalModels.has(key)) throw err;
    if (!OPTIONAL_FIELDS.test(`${err.extra.upstreamParam ?? ""} ${err.message}`)) throw err;
    console.warn(`[psst] ${label} (${cfg.model}) rejected optional fields: ${err.message}`);
    minimalModels.add(key);
    res = await send(true);
  }

  const data = (await res.json()) as { text?: unknown };
  if (typeof data.text !== "string") {
    throw new AppError(502, "provider_error", "Taligenkänningen gav ett oväntat svar.");
  }
  return data.text.trim();
}
