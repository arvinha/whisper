import type { TtsConfig } from "./config";
import { providerFetch } from "./errors";

const LANGUAGE_NAME: Record<string, string> = {
  sv: "Swedish",
  da: "Danish",
  en: "English",
};

const AZURE_LOCALE: Record<string, string> = {
  sv: "sv-SE",
  da: "da-DK",
  en: "en-US",
};

export async function synthesizeSpeech(
  cfg: TtsConfig,
  text: string,
  lang: string,
  signal: AbortSignal,
): Promise<Response> {
  return cfg.provider === "azure"
    ? azureSpeech(cfg, text, lang, signal)
    : openaiSpeech(cfg, text, lang, signal);
}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

function azureSpeech(cfg: TtsConfig, text: string, lang: string, signal: AbortSignal): Promise<Response> {
  const voice = cfg.voices[lang] ?? cfg.voices.other;
  // Multilingual voices detect the language of the text themselves.
  const locale = AZURE_LOCALE[lang] ?? "en-US";
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${escapeXml(voice)}"><prosody rate="+8%">${escapeXml(text)}</prosody></voice></speak>`;
  return providerFetch("Azure", cfg.baseUrl, {
    method: "POST",
    headers: {
      "ocp-apim-subscription-key": cfg.apiKey,
      "content-type": "application/ssml+xml",
      "x-microsoft-outputformat": "audio-24khz-48kbitrate-mono-mp3",
      "user-agent": "psst",
    },
    body: ssml,
    signal,
  });
}

function openaiSpeech(cfg: TtsConfig, text: string, lang: string, signal: AbortSignal): Promise<Response> {
  const language = LANGUAGE_NAME[lang] ?? "the language of the text";
  const body: Record<string, unknown> = {
    model: cfg.model,
    voice: cfg.voice,
    input: text,
    response_format: "mp3",
  };
  if (cfg.model.startsWith("gpt-")) {
    body.instructions = `Speak ${language} like a native speaker, with native pronunciation and no foreign accent. Calm, clear and slightly fast, quietly, like discreetly giving a friend a hint.`;
  }
  return providerFetch("OpenAI", `${cfg.baseUrl}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
