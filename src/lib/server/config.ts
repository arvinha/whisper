import type { LlmProvider, PublicConfig, SttProvider, TtsProvider } from "@/lib/shared/types";
import { accountInfo, accountsEnabled, billingEnabled, supportEmail, type Account } from "./accounts";
import { mailEnabled } from "./mail";
import { enabledProviders } from "./oauth";

type RealProvider = "openai" | "anthropic" | "groq" | "deepseek";
type RealStt = Exclude<SttProvider, "mock">;
type RealLlm = Exclude<LlmProvider, "mock">;

export interface SttConfig {
  provider: SttProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface TtsConfig {
  provider: TtsProvider;
  model: string;
  /** The Swedish voice for Azure; the only voice for OpenAI. */
  voice: string;
  /** Azure voice per language code, with "other" for the rest. */
  voices: Record<string, string>;
  apiKey: string;
  baseUrl: string;
}

export interface ServerConfig {
  stt: SttConfig | null;
  llm: LlmConfig | null;
  tts: TtsConfig | null;
  password: string;
  /** Personal codes from APP_USERS="Mamma:sol123,Pappa:hav456", so each person can be told apart and removed. */
  users: AppUser[];
  mock: boolean;
  phoneLog: boolean;
  problems: string[];
}

export interface AppUser {
  name: string;
  code: string;
}

function parseUsers(raw: string): AppUser[] {
  return raw
    .split(/[,;\n]/)
    .map((entry) => {
      const i = entry.indexOf(":");
      return i > 0 ? { name: entry.slice(0, i).trim(), code: entry.slice(i + 1).trim() } : null;
    })
    .filter((u): u is AppUser => !!u && !!u.name && u.code.length >= 4);
}

const KEY_ENV: Record<RealProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

const BASE_URL: Record<RealProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
};

const DEFAULT_STT_MODEL: Record<RealStt, string> = {
  openai: "gpt-transcribe",
  groq: "whisper-large-v3-turbo",
};

const DEFAULT_LLM_MODEL: Record<RealLlm, string> = {
  openai: "gpt-6-luna",
  anthropic: "claude-haiku-5-5",
  groq: "openai/gpt-oss-120b",
  deepseek: "deepseek-flash",
};

/** "auto" picks the first provider in this order that has a key. */
const STT_ORDER: readonly RealStt[] = ["openai", "groq"];
const LLM_ORDER: readonly RealLlm[] = ["openai", "anthropic", "groq", "deepseek"];

export const PROVIDER_LABEL: Record<RealProvider | "mock", string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  groq: "Groq",
  deepseek: "DeepSeek",
  mock: "Testläge",
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function apiKey(provider: RealProvider): string {
  return env(KEY_ENV[provider]);
}

function envFileName(): string {
  return env("VERCEL") ? "Vercels Environment Variables" : ".env.local";
}

function resolveProvider<T extends RealProvider>(
  label: string,
  requestedRaw: string,
  order: readonly T[],
  problems: string[],
): T | null {
  const requested = requestedRaw.toLowerCase();
  if (requested && requested !== "auto") {
    const match = order.find((p) => p === requested);
    if (!match) {
      problems.push(
        `${label}: okänd leverantör "${requestedRaw}". Välj ${order.join(", ")} eller auto.`,
      );
      return null;
    }
    if (!apiKey(match)) {
      problems.push(`${label}: ${KEY_ENV[match]} saknas i ${envFileName()}.`);
      return null;
    }
    return match;
  }
  return order.find((p) => apiKey(p) !== "") ?? null;
}

function positiveInt(name: string): number | null {
  const n = Number(env(name));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function getServerConfig(): ServerConfig {
  const problems: string[] = [];
  const password = env("APP_PASSWORD");
  const users = parseUsers(env("APP_USERS"));
  const mock = ["1", "true", "yes", "on"].includes(env("MOCK_AI").toLowerCase());
  const phoneLog = ["1", "true", "yes", "on"].includes(env("PHONE_LOG").toLowerCase());

  if (mock) {
    return {
      stt: { provider: "mock", model: "mock", apiKey: "", baseUrl: "" },
      llm: { provider: "mock", model: "mock", apiKey: "", baseUrl: "" },
      tts: null,
      password,
      users,
      mock,
      phoneLog,
      problems,
    };
  }

  // A public deployment without a password would let anyone with the link spend the API keys.
  if (!password && users.length === 0 && env("VERCEL")) {
    problems.push(
      "Sätt APP_PASSWORD i Vercel (Settings → Environment Variables) och gör en ny deploy. Utan lösenord kan vem som helst med länken använda dina API-nycklar.",
    );
    return { stt: null, llm: null, tts: null, password, users, mock, phoneLog, problems };
  }

  const sttProvider = resolveProvider("Taligenkänning", env("STT_PROVIDER"), STT_ORDER, problems);
  const llmProvider = resolveProvider("Svarsmodell", env("LLM_PROVIDER"), LLM_ORDER, problems);

  if (!sttProvider && !problems.some((p) => p.startsWith("Taligenkänning"))) {
    problems.push(
      `Taligenkänning: lägg in GROQ_API_KEY (gratis) eller OPENAI_API_KEY i ${envFileName()}.`,
    );
  }
  if (!llmProvider && !problems.some((p) => p.startsWith("Svarsmodell"))) {
    problems.push(
      `Svarsmodell: lägg in GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY eller DEEPSEEK_API_KEY i ${envFileName()}.`,
    );
  }

  const stt: SttConfig | null = sttProvider
    ? {
        provider: sttProvider,
        model: env("STT_MODEL") || DEFAULT_STT_MODEL[sttProvider],
        apiKey: apiKey(sttProvider),
        baseUrl: BASE_URL[sttProvider],
      }
    : null;

  const llm: LlmConfig | null = llmProvider
    ? {
        provider: llmProvider,
        model: env("LLM_MODEL") || DEFAULT_LLM_MODEL[llmProvider],
        apiKey: apiKey(llmProvider),
        baseUrl: BASE_URL[llmProvider],
      }
    : null;

  const tts = resolveTts(problems);

  return { stt, llm, tts, password, users, mock, phoneLog, problems };
}

/** "auto" prefers Azure, whose Swedish and Danish voices are native speakers. */
function resolveTts(problems: string[]): TtsConfig | null {
  if (["0", "off", "false", "no"].includes(env("CLOUD_TTS").toLowerCase())) return null;
  const requested = env("TTS_PROVIDER").toLowerCase() || "auto";
  const azureKey = env("AZURE_SPEECH_KEY");
  const azureRegion = env("AZURE_SPEECH_REGION").toLowerCase();

  if (requested === "azure" || (requested === "auto" && azureKey)) {
    if (!azureKey || !/^[a-z0-9]+$/.test(azureRegion)) {
      problems.push(
        `Röst: Azure kräver både AZURE_SPEECH_KEY och AZURE_SPEECH_REGION (t.ex. swedencentral) i ${envFileName()}.`,
      );
      return null;
    }
    const sv = env("AZURE_VOICE_SV") || "sv-SE-SofieNeural";
    return {
      provider: "azure",
      model: "neural",
      voice: sv,
      voices: {
        sv,
        da: env("AZURE_VOICE_DA") || "da-DK-ChristelNeural",
        en: env("AZURE_VOICE_EN") || "en-US-AvaMultilingualNeural",
        other: "en-US-AvaMultilingualNeural",
      },
      apiKey: azureKey,
      baseUrl: `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    };
  }

  if (requested === "openai" || requested === "auto") {
    if (!apiKey("openai")) {
      if (requested === "openai") problems.push(`Röst: OPENAI_API_KEY saknas i ${envFileName()}.`);
      return null;
    }
    const voice = env("TTS_VOICE") || "marin";
    return {
      provider: "openai",
      model: env("TTS_MODEL") || "gpt-4o-mini-tts",
      voice,
      voices: {},
      apiKey: apiKey("openai"),
      baseUrl: BASE_URL.openai,
    };
  }

  problems.push(`Röst: okänd leverantör "${requested}". Välj azure, openai eller auto.`);
  return null;
}

/** About 10K tokens; with Claude's prompt cache it adds little delay after the first answer. */
export const MAX_PREP_CHARS = 40_000;
export const MAX_PREP_CHARS_FRUGAL = 4_000;
export { MAX_DEEP_CHARS } from "@/lib/shared/types";

const DEFAULT_DEEP_MODEL: Partial<Record<LlmProvider, string>> = { anthropic: "claude-sonnet-5-5" };

/**
 * The model that reads all of the user's material (CV, job ad, every code file) for the concrete
 * answer after the quick opener. Sonnet with Claude: Haiku answers code questions well but invents
 * personal things (plans, examples) far more often. DEEP_MODEL picks another model from the same
 * provider.
 */
export function getDeepConfig(config: ServerConfig): LlmConfig | null {
  const llm = config.llm;
  if (!llm || llm.provider === "mock") return llm;
  const model = env("DEEP_MODEL") || DEFAULT_DEEP_MODEL[llm.provider];
  return model ? { ...llm, model } : llm;
}

/**
 * A model that can read photos and scanned PDFs. The answer model if it can, otherwise Claude or
 * OpenAI if there is a key for either.
 */
export function getVisionConfig(config: ServerConfig): LlmConfig | null {
  const llm = config.llm;
  if (llm && (llm.provider === "anthropic" || llm.provider === "openai" || llm.provider === "mock")) return llm;
  for (const provider of ["anthropic", "openai"] as const) {
    if (apiKey(provider)) {
      return { provider, model: DEFAULT_LLM_MODEL[provider], apiKey: apiKey(provider), baseUrl: BASE_URL[provider] };
    }
  }
  return null;
}

/** Tight token limits (Groq's free tier, or LLM_FRUGAL=1). */
export function isFrugal(llm: LlmConfig | null): boolean {
  const frugalEnv = env("LLM_FRUGAL").toLowerCase();
  return frugalEnv ? ["1", "true", "yes", "on"].includes(frugalEnv) : llm?.provider === "groq";
}

export function toPublicConfig(
  config: ServerConfig,
  caller: { name: string; account: Account | null } | null,
): PublicConfig {
  const { stt, llm, tts } = config;
  const isGroqStt = stt?.provider === "groq";
  const frugal = isFrugal(llm);
  return {
    stt: stt
      ? {
          provider: stt.provider,
          model: stt.model,
          // Groq free tier: 20 requests/minute for Whisper.
          maxRequestsPerMinute: positiveInt("STT_MAX_RPM") ?? (isGroqStt ? 20 : 300),
          // Groq bills every request as at least 10 s against 7,200 audio seconds per hour,
          // which allows about 12 requests per minute in the long run.
          paceRequestsPerMinute: positiveInt("STT_PACE_RPM") ?? (isGroqStt ? 12 : 120),
          minSegmentMs: isGroqStt ? 4000 : 1500,
        }
      : null,
    llm: llm
      ? {
          provider: llm.provider,
          model: llm.model,
          // Groq free tier allows about 8K tokens/minute, so pre-generation must be sparse.
          minPrefetchIntervalMs: frugal ? 30000 : 3000,
          maxContextChars: frugal ? 3000 : 6000,
          maxPrepChars: frugal ? MAX_PREP_CHARS_FRUGAL : MAX_PREP_CHARS,
          frugal,
        }
      : null,
    cloudTts: tts ? { provider: tts.provider, model: tts.model, voice: tts.voice } : null,
    passwordRequired: config.password !== "" || config.users.length > 0 || accountsEnabled(),
    authorized: caller !== null,
    user: caller?.name ?? "",
    mock: config.mock,
    phoneLog: config.phoneLog,
    problems: config.problems,
    accounts: {
      enabled: accountsEnabled(),
      billing: billingEnabled(),
      mail: accountsEnabled() && mailEnabled(),
      providers: enabledProviders(),
      supportEmail: supportEmail(),
    },
    account: caller?.account ? accountInfo(caller.account) : null,
    remindersShortcutUrl: /^https:\/\/www\.icloud\.com\/shortcuts\//.test(env("REMINDERS_SHORTCUT_URL"))
      ? env("REMINDERS_SHORTCUT_URL")
      : "",
  };
}
