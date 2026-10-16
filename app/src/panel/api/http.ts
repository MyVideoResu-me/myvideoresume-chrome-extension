/**
 * The one HTTP port to api.hired.video. Adds the Bearer JWT, retries once
 * after a silent token refresh on 401, unwraps the `{ success, data }`
 * envelope, and turns error envelopes into a typed ApiError the UI can
 * explain (Pro wall, usage limit, not connected, …).
 */
import { apiUrl } from "../platform/config";
import { sendToWorker, storageGet, storageRemove } from "../platform/chrome";

export const JWT_KEY = "jwtToken";
const LAST_USER_KEY = "lastUserId";

export type ApiErrorKind = "auth" | "pro" | "limit" | "notFound" | "conflict" | "invalid" | "network" | "server";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly upgradeUrl: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get kind(): ApiErrorKind {
    if (this.status === 0) return "network";
    if (this.status === 401) return "auth";
    if (this.status === 402 || this.code === "PRO_REQUIRED") return "pro";
    if (this.status === 429) return "limit";
    if (this.status === 404) return "notFound";
    if (this.status === 409) return "conflict";
    if (this.status === 400 || this.status === 422) return "invalid";
    return "server";
  }
}

export function getToken(): Promise<string | null> {
  return storageGet<string>(JWT_KEY).then((v) => v ?? null);
}

/** Drop the session; the session store reacts to the storage change. */
export function clearSession(): Promise<void> {
  return storageRemove([JWT_KEY, LAST_USER_KEY]);
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
};

function withQuery(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function send(path: string, options: RequestOptions, token: string): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return fetch(apiUrl(withQuery(path, options.query)), {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });
}

async function toError(res: Response): Promise<ApiError> {
  const json = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; upgradeUrl?: string; details?: { upgradeUrl?: string } } }
    | null;
  const err = json?.error;
  return new ApiError(
    res.status,
    err?.code ?? `HTTP_${res.status}`,
    err?.message ?? res.statusText,
    err?.upgradeUrl ?? err?.details?.upgradeUrl ?? null,
  );
}

function unwrap<T>(json: unknown): T {
  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return (json as { data: T }).data;
  }
  return json as T;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let token = await getToken();
  if (!token) throw new ApiError(401, "NOT_SIGNED_IN", "Not signed in");
  let res: Response;
  try {
    res = await send(path, options, token);
    if (res.status === 401) {
      await sendToWorker({ action: "refreshTokenNow" });
      const refreshed = await getToken();
      if (refreshed && refreshed !== token) {
        token = refreshed;
        res = await send(path, options, token);
      }
    }
  } catch {
    throw new ApiError(0, "NETWORK", "Network error");
  }
  if (res.status === 401) {
    await clearSession();
    throw await toError(res);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return unwrap<T>(await res.json().catch(() => null));
}
