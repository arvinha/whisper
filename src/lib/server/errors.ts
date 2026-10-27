import type { ApiErrorBody, ErrorCode } from "@/lib/shared/types";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: {
      retryAfterSeconds?: number;
      upstreamStatus?: number;
      upstreamParam?: string;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

const NO_STORE = { "cache-control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: err.message, code: err.code };
    if (err.extra.retryAfterSeconds !== undefined) {
      body.retryAfterSeconds = err.extra.retryAfterSeconds;
    }
    return json(body, err.status);
  }
  if (isAbortError(err)) {
    return json(
      { error: "Tidsgränsen överskreds.", code: "timeout" } satisfies ApiErrorBody,
      504,
    );
  }
  console.error("[psst] unexpected error", err);
  return json(
    { error: "Internt fel på servern.", code: "internal" } satisfies ApiErrorBody,
    500,
  );
}

/** Aborts when the client disconnects or when the timeout passes. */
export function requestSignal(req: Request, timeoutMs: number): AbortSignal {
  return AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  return undefined;
}

function parseUpstreamError(text: string): { message: string; param?: string } {
  try {
    const data = JSON.parse(text) as {
      error?: { message?: unknown; param?: unknown } | string;
      message?: unknown;
    };
    if (typeof data.error === "string") return { message: data.error };
    const message =
      typeof data.error?.message === "string"
        ? data.error.message
        : typeof data.message === "string"
          ? data.message
          : text;
    const param =
      typeof data.error?.param === "string" ? data.error.param : undefined;
    return { message, param };
  } catch {
    return { message: text };
  }
}

/** fetch() against an AI provider with uniform error mapping. */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store" });
  } catch (err) {
    if (isAbortError(err)) {
      throw new AppError(504, "timeout", `${provider} svarade inte i tid.`);
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new AppError(502, "provider_error", `Kunde inte nå ${provider}: ${reason}`);
  }
  if (res.ok) return res;

  const raw = await res.text().catch(() => "");
  const { message, param } = parseUpstreamError(raw);
  const short = (message || res.statusText || "okänt fel").slice(0, 300);

  if (res.status === 401 || res.status === 403) {
    throw new AppError(
      502,
      "provider_auth",
      `${provider} avvisade API-nyckeln (${res.status}). Kontrollera nyckeln i .env.local. ${short}`,
      { upstreamStatus: res.status },
    );
  }
  if (res.status === 429) {
    throw new AppError(
      429,
      "rate_limited",
      `${provider}: för många anrop just nu (gratisnivåns gräns). ${short}`,
      {
        retryAfterSeconds: parseRetryAfter(res.headers.get("retry-after")) ?? 10,
        upstreamStatus: 429,
      },
    );
  }
  throw new AppError(
    502,
    "provider_error",
    `${provider} svarade med fel ${res.status}: ${short}`,
    { upstreamStatus: res.status, upstreamParam: param },
  );
}
