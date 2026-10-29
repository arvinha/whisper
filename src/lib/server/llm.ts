import { PROVIDER_LABEL, type LlmConfig } from "./config";
import { AppError, providerFetch } from "./errors";

export interface Attachment {
  /** "application/pdf" or an image type such as "image/jpeg". */
  mediaType: string;
  /** Base64 without a data: prefix. */
  data: string;
  name: string;
}

export interface ChatRequest {
  system: string;
  /**
   * Long material that stays the same across many calls (the user's CV, job ad…). It goes after
   * the system prompt, marked for Claude's prompt cache so repeated answers start faster.
   */
  context?: string;
  user: string;
  /** Files for the model to read. Only Claude and OpenAI can. */
  attachments?: Attachment[];
  maxTokens: number;
  temperature: number;
  json: boolean;
  signal: AbortSignal;
  /** Lets Claude search the web this many times (billed per search). Ignored by other providers. */
  webSearches?: number;
  /** Where the user roughly is, so searches for weather or local news find the right place. */
  webCountry?: string;
  /** Lets Claude open web pages this many times (pages named in the message, and links on them). */
  webFetches?: number;
  /** Makes Claude search before answering, for questions only the internet can answer. */
  mustSearch?: boolean;
  /** Tools this server runs itself, such as searching the user's material. Claude only. */
  localTools?: LocalTool[];
  /** Rounds of local tool calls before the model has to answer. */
  maxToolRounds?: number;
}

export interface LocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): string;
}

type Body = Record<string, unknown>;

function anthropicContent(req: ChatRequest): unknown {
  if (!req.attachments?.length) return req.user;
  const files = req.attachments.map((a) => ({
    type: a.mediaType === "application/pdf" ? "document" : "image",
    source: { type: "base64", media_type: a.mediaType, data: a.data },
  }));
  return [...files, { type: "text", text: req.user }];
}

function openAiContent(req: ChatRequest): unknown {
  if (!req.attachments?.length) return req.user;
  const files = req.attachments.map((a) =>
    a.mediaType === "application/pdf"
      ? { type: "file", file: { filename: a.name, file_data: `data:${a.mediaType};base64,${a.data}` } }
      : { type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } },
  );
  return [{ type: "text", text: req.user }, ...files];
}

/**
 * Parameters we send to reduce latency or force JSON. Provider APIs change often, so if one of
 * them is rejected with HTTP 400 we drop it, remember that for this model, and retry.
 */
const OPTIONAL_PARAMS = [
  "response_format",
  "reasoning_effort",
  "include_reasoning",
  "thinking",
  "output_config",
  "temperature",
  "tool_choice",
  "tools",
] as const;

const rejectedParams = new Map<string, Set<string>>();

/**
 * Parameters these models are known to reject. Without this, every new server instance spends a
 * round trip per parameter finding out, right when the user is waiting for the first answer.
 */
const KNOWN_REJECTED: Array<[RegExp, string[]]> = [
  [/^claude-(sonnet|opus)-[5-9]/, ["temperature", "thinking"]],
  [/^claude-haiku-[5-9]/, ["temperature"]],
];

function initialRejected(model: string): Set<string> {
  return new Set(KNOWN_REJECTED.find(([re]) => re.test(model))?.[1] ?? []);
}

const WEB_FETCH = "web_fetch";
/** A page beyond this is cut; enough for a front page or an article, small enough to stay fast. */
const WEB_FETCH_TOKENS = 10_000;

/** Models that reject tool_choice "any" (forcing a tool call); they are told to search in words instead. */
const NO_FORCED_TOOLS = /^claude-(sonnet|opus)-[5-9]/;

function anthropicTools(req: ChatRequest, turns: unknown[], mustAnswer: boolean, model: string): Body {
  const tools: unknown[] = [];
  if (req.webSearches) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: req.webSearches,
      ...(req.webCountry ? { user_location: { type: "approximate", country: req.webCountry } } : {}),
    });
  }
  if (req.webFetches) {
    tools.push({ type: "web_fetch_20250910", name: WEB_FETCH, max_uses: req.webFetches, max_content_tokens: WEB_FETCH_TOKENS });
  }
  for (const t of req.localTools ?? []) tools.push({ name: t.name, description: t.description, input_schema: t.inputSchema });
  if (tools.length === 0) return {};
  const force = req.mustSearch && turns.length === 0 && !NO_FORCED_TOOLS.test(model);
  const choice = mustAnswer ? { type: "none" } : force ? { type: "any" } : null;
  return { tools, ...(choice ? { tool_choice: choice } : {}) };
}

/**
 * `turns` are the model's earlier tool calls in this answer and their results; `mustAnswer` makes
 * it answer now instead of calling more tools.
 */
function buildRequest(
  cfg: LlmConfig,
  req: ChatRequest,
  turns: unknown[] = [],
  mustAnswer = false,
): { url: string; headers: HeadersInit; body: Body } {
  if (req.attachments?.length && cfg.provider !== "anthropic" && cfg.provider !== "openai") {
    throw new AppError(400, "bad_request", `${PROVIDER_LABEL[cfg.provider]} kan inte läsa bilder eller skannade PDF:er.`);
  }
  const messages = [
    { role: "system", content: req.context ? `${req.system}\n\n${req.context}` : req.system },
    { role: "user", content: openAiContent(req) },
  ];
  const jsonFormat = req.json ? { response_format: { type: "json_object" } } : {};

  switch (cfg.provider) {
    case "anthropic":
      return {
        url: `${cfg.baseUrl}/messages`,
        headers: {
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          ...(req.webFetches ? { "anthropic-beta": "web-fetch-2025-09-10" } : {}),
        },
        body: {
          model: cfg.model,
          max_tokens: req.maxTokens,
          system: req.context
            ? [
                { type: "text", text: req.system },
                { type: "text", text: req.context, cache_control: { type: "ephemeral" } },
              ]
            : req.system,
          messages: [{ role: "user", content: anthropicContent(req) }, ...turns],
          temperature: req.temperature,
          output_config: { effort: "low" },
          thinking: { type: "disabled" },
          ...anthropicTools(req, turns, mustAnswer, cfg.model),
        },
      };
    case "openai":
      return {
        url: `${cfg.baseUrl}/chat/completions`,
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: {
          model: cfg.model,
          messages,
          max_completion_tokens: req.maxTokens,
          reasoning_effort: "none",
          ...jsonFormat,
        },
      };
    case "groq": {
      const model = cfg.model.toLowerCase();
      const reasoning = model.includes("gpt-oss")
        ? { reasoning_effort: "low", include_reasoning: false }
        : model.includes("qwen")
          ? { reasoning_effort: "none" }
          : {};
      return {
        url: `${cfg.baseUrl}/chat/completions`,
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: {
          model: cfg.model,
          messages,
          max_completion_tokens: req.maxTokens,
          temperature: req.temperature,
          ...reasoning,
          ...jsonFormat,
        },
      };
    }
    case "deepseek":
      return {
        url: `${cfg.baseUrl}/chat/completions`,
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: {
          model: cfg.model,
          messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          thinking: { type: "disabled" },
          ...jsonFormat,
        },
      };
    case "mock":
      throw new AppError(500, "internal", "Testläget anropar ingen modell.");
  }
}

function findRejectedParam(err: AppError, body: Body): string | null {
  const present = OPTIONAL_PARAMS.filter((p) => p in body);
  const param = err.extra.upstreamParam?.split(".")[0];
  if (param && (present as readonly string[]).includes(param)) return param;
  const message = err.message.toLowerCase();
  for (const p of present) {
    if (message.includes(p)) return p;
  }
  if (message.includes("json") && present.includes("response_format")) return "response_format";
  if (message.includes("reasoning") && present.includes("reasoning_effort")) return "reasoning_effort";
  if (message.includes("effort") && present.includes("output_config")) return "output_config";
  if ((message.includes("web_search") || message.includes("tool")) && present.includes("tools")) return "tools";
  return null;
}

interface OpenAiStyleResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
  };
}

function logUsage(cfg: LlmConfig, data: unknown) {
  const u = (data as AnthropicResponse).usage;
  if (!u) return;
  console.log(
    `[psst] tokens ${cfg.model}: in ${u.input_tokens ?? 0}, cache read ${u.cache_read_input_tokens ?? 0}, cache write ${u.cache_creation_input_tokens ?? 0}, out ${u.output_tokens ?? 0}` +
      (u.server_tool_use?.web_search_requests ? `, web searches ${u.server_tool_use.web_search_requests}` : "") +
      (u.server_tool_use?.web_fetch_requests ? `, pages opened ${u.server_tool_use.web_fetch_requests}` : ""),
  );
}

function extractText(cfg: LlmConfig, data: unknown): string {
  if (cfg.provider === "anthropic") {
    const res = data as AnthropicResponse;
    logUsage(cfg, res);
    const text = (res.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text && res.stop_reason === "max_tokens") {
      throw new AppError(502, "provider_error", "Modellen fick slut på tokens innan den svarade.");
    }
    return text;
  }
  const res = data as OpenAiStyleResponse;
  const choice = res.choices?.[0];
  const text = (choice?.message?.content ?? "").trim();
  if (!text && choice?.finish_reason === "length") {
    throw new AppError(502, "provider_error", "Modellen fick slut på tokens innan den svarade.");
  }
  return text;
}

export async function chat(cfg: LlmConfig, req: ChatRequest): Promise<string> {
  const label = PROVIDER_LABEL[cfg.provider];
  const tools = cfg.provider === "anthropic" ? (req.localTools ?? []) : [];
  const rounds = tools.length ? (req.maxToolRounds ?? 3) : 0;
  const turns: unknown[] = [];
  for (let round = 0; ; round++) {
    const data = (await send(cfg, req, turns, rounds > 0 && round >= rounds)) as AnthropicResponse;
    const calls = tools.length ? (data.content ?? []).filter((b) => b.type === "tool_use" && tools.some((t) => t.name === b.name)) : [];
    if (calls.length && round < rounds) {
      logUsage(cfg, data);
      turns.push({ role: "assistant", content: data.content });
      const results: unknown[] = calls.map((call) => {
        const tool = tools.find((t) => t.name === call.name)!;
        const input = call.input && typeof call.input === "object" ? (call.input as Record<string, unknown>) : {};
        return { type: "tool_result", tool_use_id: call.id, content: tool.run(input) };
      });
      if (round + 1 >= rounds) results.push({ type: "text", text: "No more searches: give your final reply now, in the format asked for." });
      turns.push({ role: "user", content: results });
      continue;
    }
    const text = extractText(cfg, data);
    if (!text) throw new AppError(502, "provider_error", `${label} gav ett tomt svar.`);
    return text;
  }
}

/** One call to the provider, retried without the optional parameters it rejects. */
async function send(cfg: LlmConfig, req: ChatRequest, turns: unknown[], mustAnswer: boolean): Promise<unknown> {
  const label = PROVIDER_LABEL[cfg.provider];
  const cacheKey = `${cfg.provider}:${cfg.model}`;
  const rejected = rejectedParams.get(cacheKey) ?? initialRejected(cfg.model);

  for (let attempt = 0; attempt <= OPTIONAL_PARAMS.length + 1; attempt++) {
    const { url, headers, body } = buildRequest(cfg, req, turns, mustAnswer);
    for (const p of rejected) delete body[p];
    // Opening pages is a newer tool: without it the web search and the material search still work.
    if (rejected.has(WEB_FETCH) && Array.isArray(body.tools)) {
      body.tools = (body.tools as Array<{ name?: string }>).filter((t) => t.name !== WEB_FETCH);
      if ((body.tools as unknown[]).length === 0) delete body.tools;
    }
    try {
      const res = await providerFetch(label, url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal,
      });
      return await res.json();
    } catch (err) {
      if (err instanceof AppError && err.extra.upstreamStatus === 400) {
        const fetchTool = /web_fetch|web-fetch/i.test(err.message) && !rejected.has(WEB_FETCH) ? WEB_FETCH : null;
        const param = fetchTool ?? findRejectedParam(err, body);
        if (param && !rejected.has(param)) {
          rejected.add(param);
          rejectedParams.set(cacheKey, rejected);
          console.warn(`[psst] ${label} (${cfg.model}) rejected "${param}", retrying without it: ${err.message.slice(0, 300)}`);
          continue;
        }
      }
      throw err;
    }
  }
  throw new AppError(502, "provider_error", `${label} accepterade inte anropet.`);
}
