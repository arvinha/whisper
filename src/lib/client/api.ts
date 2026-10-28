import type {
  AccountInfo,
  AnswerRequest,
  AnswerResult,
  ApiErrorBody,
  AuthResult,
  CheckoutKind,
  ErrorCode,
  ExtractResult,
  LinkResult,
  LanguageCode,
  PrepareRequest,
  PrepBrief,
  PublicConfig,
  SelfTestResult,
  SummaryRequest,
  SummaryResult,
  TranscribeResult,
} from "@/lib/shared/types";
import { getT, uiLang } from "./i18n";

const PASSWORD_HEADER = "x-psst-password";

/** Server messages are Swedish; the common ones are shown in the app's language instead. */
function userMessage(code: ErrorCode, serverMessage: string | undefined, retryAfterSeconds?: number): string {
  const t = getT();
  switch (code) {
    case "unauthorized":
      return t.errors.unauthorized;
    case "rate_limited":
      return t.errors.rateLimited(retryAfterSeconds);
    case "timeout":
      return t.errors.timeout;
    case "network":
      return t.errors.network;
    case "internal":
      return t.errors.generic;
    case "plan_required":
      return t.errors.planRequired;
    case "trial_busy":
      return t.errors.trialBusy;
  }
  if (!serverMessage) return t.errors.generic;
  if (uiLang() === "sv" || code === "provider_auth" || code === "not_configured") return serverMessage;
  return t.errors.generic;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Errors that will not go away by retrying. */
  get fatal(): boolean {
    return (
      this.code === "unauthorized" ||
      this.code === "provider_auth" ||
      this.code === "not_configured" ||
      this.isPlanError
    );
  }

  /** The account's free minutes or balance have run out. */
  get isPlanError(): boolean {
    return this.code === "plan_required" || this.code === "trial_busy";
  }
}

/** AbortSignal.any is missing in Safari before 17.4. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
  const abort = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function request(
  path: string,
  init: RequestInit & { password: string; timeoutMs: number },
): Promise<Response> {
  const { password, timeoutMs, signal, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (password) headers.set(PASSWORD_HEADER, encodeURIComponent(password));

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, signal: withTimeout(signal ?? undefined, timeoutMs) });
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(userMessage("timeout", undefined), "timeout", 0);
    }
    throw new ApiError(userMessage("network", undefined), "network", 0);
  }

  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as Partial<ApiErrorBody>;
    } catch {
      // not JSON
    }
    const code = body.code ?? (res.status === 401 ? "unauthorized" : "internal");
    throw new ApiError(userMessage(code, body.error, body.retryAfterSeconds), code, res.status, body.retryAfterSeconds);
  }
  return res;
}

export class Api {
  constructor(private readonly getPassword: () => string) {}

  async config(): Promise<PublicConfig> {
    const res = await request("/api/config", { password: this.getPassword(), timeoutMs: 10_000 });
    return (await res.json()) as PublicConfig;
  }

  async transcribe(
    wav: Blob,
    opts: { language?: LanguageCode; prompt?: string; signal?: AbortSignal },
  ): Promise<TranscribeResult> {
    const form = new FormData();
    form.append("audio", wav, "segment.wav");
    if (opts.language) form.append("language", opts.language);
    if (opts.prompt) form.append("prompt", opts.prompt);
    const res = await request("/api/transcribe", {
      method: "POST",
      body: form,
      password: this.getPassword(),
      timeoutMs: 30_000,
      signal: opts.signal,
    });
    return (await res.json()) as TranscribeResult;
  }

  async answer(req: AnswerRequest, signal?: AbortSignal): Promise<AnswerResult> {
    const res = await request("/api/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      password: this.getPassword(),
      timeoutMs: req.mode === "deep" ? 55_000 : 30_000,
      signal,
    });
    return (await res.json()) as AnswerResult;
  }

  async summary(req: SummaryRequest, signal?: AbortSignal): Promise<SummaryResult> {
    const res = await request("/api/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      password: this.getPassword(),
      timeoutMs: 150_000,
      signal,
    });
    return (await res.json()) as SummaryResult;
  }

  async extract(file: Blob, name: string, signal?: AbortSignal): Promise<ExtractResult> {
    const form = new FormData();
    form.append("file", file, name);
    const res = await request("/api/extract", {
      method: "POST",
      body: form,
      password: this.getPassword(),
      timeoutMs: 95_000,
      signal,
    });
    return (await res.json()) as ExtractResult;
  }

  async link(url: string, signal?: AbortSignal): Promise<LinkResult> {
    const res = await request("/api/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      password: this.getPassword(),
      timeoutMs: 95_000,
      signal,
    });
    return (await res.json()) as LinkResult;
  }

  async prepare(req: PrepareRequest, signal?: AbortSignal): Promise<PrepBrief> {
    const res = await request("/api/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      password: this.getPassword(),
      timeoutMs: 125_000,
      signal,
    });
    return (await res.json()) as PrepBrief;
  }

  async tts(text: string, lang: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await request("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang }),
      password: this.getPassword(),
      timeoutMs: 30_000,
      signal,
    });
    return res.arrayBuffer();
  }

  async log(events: string[]): Promise<void> {
    await request("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      password: this.getPassword(),
      timeoutMs: 10_000,
    });
  }

  /** E-mails a six-digit code (sign up, log in, or a forgotten password). */
  async requestCode(email: string, purpose: "login" | "reset", lang: string): Promise<void> {
    await this.postJson<{ ok: true }>("/api/account/code", { email, purpose, lang }, "");
  }

  async verifyCode(req: { email: string; code: string; name?: string; password?: string; device: string }): Promise<AuthResult> {
    return this.postJson<AuthResult>("/api/account/verify", req, "");
  }

  async login(email: string, password: string): Promise<AuthResult> {
    return this.postJson<AuthResult>("/api/account/login", { email, password }, "");
  }

  /** A Stripe page to pay on. */
  async checkout(kind: CheckoutKind): Promise<{ url: string }> {
    return this.postJson<{ url: string }>("/api/account/checkout", { kind }, this.getPassword());
  }

  /** Stripe's page with receipts for earlier top-ups. */
  async portal(): Promise<{ url: string }> {
    return this.postJson<{ url: string }>("/api/account/portal", {}, this.getPassword());
  }

  /** Charges one answer the user asked for; returns the account afterwards. */
  async answered(): Promise<{ account: AccountInfo | null }> {
    return this.postJson<{ account: AccountInfo | null }>("/api/account/answered", {}, this.getPassword());
  }

  private async postJson<T>(path: string, body: unknown, password: string): Promise<T> {
    const res = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      password,
      timeoutMs: 25_000,
    });
    return (await res.json()) as T;
  }

  async selftest(): Promise<SelfTestResult> {
    const res = await request("/api/selftest", {
      method: "POST",
      password: this.getPassword(),
      timeoutMs: 70_000,
    });
    return (await res.json()) as SelfTestResult;
  }
}
