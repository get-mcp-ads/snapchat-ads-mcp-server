/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { SNAP_API_BASE, SNAP_API_ORIGIN, SNAP_TOKEN_URL } from "./hosts.js";

export type Row = Record<string, any>;

export type SnapClientOptions = {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  allowedAccountIds: string[];
};

export const plural = (kind: string) => (kind === "media" ? "media" : kind + "s");

/** Snap wraps every entity: `{ campaigns: [{ campaign: {...} }] }`. */
export function rows(data: Row, collection: string, singular: string): Row[] {
  return (Array.isArray(data?.[collection]) ? data[collection] : []).map((r: Row) => r?.[singular]).filter(Boolean);
}

export class SnapApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SnapApiError";
  }
}

/** Only an explicit rejection of a single create is known not to have applied. */
export class SnapValidationRejection extends SnapApiError {}

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const JSON_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
/** Renew a little before Snap's announced expiry, so a request never races it. */
const EXPIRY_MARGIN_MS = 60_000;
const ENTITY_ID = /^[0-9A-Za-z-]{1,64}$/;
const ACCOUNT_IN_PATH = /\/adaccounts\/([^/?]+)/g;
const UNKNOWN_WRITE = " For a write, the outcome is unknown: read the entity before retrying, and never resend it blindly.";

/** Read a body up to a byte limit, so one oversized reply cannot exhaust memory. */
async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel().catch(() => undefined);
      throw new SnapApiError(`Snap response exceeded ${Math.round(limit / 1024 / 1024)} MB. Narrow the request: a shorter interval, fewer fields or a smaller page.`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

export class SnapClient {
  private accessToken?: string;
  private refreshToken?: string;
  private expiresAt = 0;
  private renewal?: Promise<string>;
  private readonly secrets = new Set<string>();
  private readonly allowed: Set<string>;

  constructor(private readonly options: SnapClientOptions) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.allowed = new Set(options.allowedAccountIds.map((id) => id.toLowerCase()));
    for (const value of [options.accessToken, options.refreshToken, options.clientSecret]) if (value) this.secrets.add(value);
  }

  /** Replace every credential this client has held with a marker. */
  redact(text: string): string {
    let out = text;
    for (const value of this.secrets) if (value.length >= 4) out = out.split(value).join("[REDACTED]");
    return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]");
  }

  /** Refuse an ad account that SNAPCHAT_ADS_ACCOUNT_IDS does not list. */
  assertAllowed(accountId: string): void {
    if (!this.allowed.has(String(accountId).toLowerCase())) {
      throw new SnapApiError("This Snapchat ad account is not in SNAPCHAT_ADS_ACCOUNT_IDS. Add it there and restart the server to use it.");
    }
  }

  private get canRenew(): boolean {
    return Boolean(this.refreshToken && this.options.clientId && this.options.clientSecret);
  }

  /** Renew the access token in memory. Nothing is written to disk or returned. */
  private renew(): Promise<string> {
    if (!this.canRenew) {
      return Promise.reject(new SnapApiError(
        "Snap rejected the access token (HTTP 401). Provide a renewed SNAPCHAT_ADS_ACCESS_TOKEN, or set SNAPCHAT_ADS_REFRESH_TOKEN, " +
          "SNAPCHAT_ADS_CLIENT_ID and SNAPCHAT_ADS_CLIENT_SECRET so the server can renew it.",
        401,
      ));
    }
    this.renewal ??= (async () => {
      let response: Response;
      try {
        response = await fetch(SNAP_TOKEN_URL, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.refreshToken!,
            client_id: this.options.clientId!,
            client_secret: this.options.clientSecret!,
          }),
        });
      } catch {
        throw new SnapApiError("Snap token renewal did not complete. Check the network and retry.");
      }
      let token: Row | null = null;
      try {
        token = JSON.parse(await readBounded(response, MAX_TOKEN_RESPONSE_BYTES));
      } catch {
        token = null;
      }
      if (!response.ok || typeof token?.access_token !== "string" || !token.access_token) {
        throw new SnapApiError(
          `Snap refused to renew the access token (HTTP ${response.status}). Check SNAPCHAT_ADS_REFRESH_TOKEN, SNAPCHAT_ADS_CLIENT_ID ` +
            "and SNAPCHAT_ADS_CLIENT_SECRET, or authorize the app again.",
          response.status,
        );
      }
      this.accessToken = token.access_token;
      this.secrets.add(token.access_token);
      if (typeof token.refresh_token === "string" && token.refresh_token) {
        this.refreshToken = token.refresh_token;
        this.secrets.add(token.refresh_token);
      }
      const seconds = Number(token.expires_in);
      this.expiresAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 - EXPIRY_MARGIN_MS : 0;
      return token.access_token as string;
    })().finally(() => {
      this.renewal = undefined;
    });
    return this.renewal;
  }

  private async token(): Promise<string> {
    const expired = this.expiresAt !== 0 && Date.now() >= this.expiresAt;
    if (this.accessToken && !expired) return this.accessToken;
    if (this.canRenew) return this.renew();
    if (this.accessToken) return this.accessToken;
    throw new SnapApiError("No Snapchat access token is configured.");
  }

  /**
   * One Snap API call. `originPath` admits the regional multipart upload paths
   * that Snap returns, such as /europe/v1/media/{id}/multipart-upload-v2, and
   * nothing else.
   */
  async request(path: string, init: { method?: string; body?: unknown; originPath?: boolean } = {}, retried = false): Promise<Row> {
    const method = init.method ?? "GET";
    if (!path.startsWith("/") || path.includes("..") || path.includes("://") || path.includes("\\") || path.includes("#")) {
      throw new SnapApiError("Invalid Snap API path.");
    }
    if (init.originPath && !/^\/(?:[a-z]{2,16}\/)?v1\/media\/[0-9a-f-]{36}\/multipart-upload-v2\?action=(ADD|FINALIZE)$/.test(path)) {
      throw new SnapApiError("Invalid regional upload path.");
    }
    for (const match of path.matchAll(ACCOUNT_IN_PATH)) this.assertAllowed(decodeURIComponent(match[1]));
    const form = init.body instanceof FormData;
    const write = method !== "GET";
    const url = (init.originPath ? SNAP_API_ORIGIN : SNAP_API_BASE) + path;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(form ? UPLOAD_TIMEOUT_MS : JSON_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          Accept: "application/json",
          ...(form ? {} : { "Content-Type": method === "PATCH" ? "application/json-patch+json" : "application/json" }),
        },
        ...(init.body !== undefined ? { body: form ? (init.body as FormData) : JSON.stringify(init.body) } : {}),
      });
    } catch (error) {
      if (error instanceof SnapApiError) throw error;
      throw new SnapApiError(`Snap request did not complete (network error, timeout or refused redirect).${write ? UNKNOWN_WRITE : " Retry later."}`);
    }
    // A 401 is a definite refusal: nothing was applied, so one renewal and one
    // retry are safe, for writes as well.
    if (response.status === 401 && !retried && this.canRenew) {
      await response.body?.cancel().catch(() => undefined);
      await this.renew();
      return this.request(path, init, true);
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new SnapApiError(
        "Snap rejected the access token (HTTP 401). Provide a renewed SNAPCHAT_ADS_ACCESS_TOKEN, or set SNAPCHAT_ADS_REFRESH_TOKEN, " +
          "SNAPCHAT_ADS_CLIENT_ID and SNAPCHAT_ADS_CLIENT_SECRET so the server can renew it.",
        401,
      );
    }
    let data: Row | null = null;
    try {
      data = JSON.parse(await readBounded(response, MAX_RESPONSE_BYTES));
    } catch (error) {
      if (error instanceof SnapApiError) throw error;
      data = null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new SnapApiError(`Snap API ${response.status}: the response was not a JSON object.${write ? UNKNOWN_WRITE : ""}`, response.status);
    }
    // Snap answers HTTP 200 with request_status ERROR or with per-item
    // sub_request_status errors. Both are failures, not results.
    const errors = Object.values(data)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .filter((v: Row) => typeof v?.sub_request_status === "string" && v.sub_request_status.toUpperCase() !== "SUCCESS");
    const requestFailed = typeof data.request_status === "string" && data.request_status.toUpperCase() !== "SUCCESS";
    if (!response.ok || requestFailed || errors.length) {
      const detail = JSON.stringify({
        request_id: data.request_id,
        code: data.error_code,
        message: data.debug_message ?? data.display_message,
        errors: errors.map((v: Row) => v.sub_request_error_reason),
      }).slice(0, 1600);
      const hint =
        response.status === 403 ? " Check that the authorizing user can access this ad account and that the app has the snapchat-marketing-api scope."
        : response.status === 429 ? " Snap rate limit reached (about 10 requests per second per access token). Wait before retrying."
        : response.status >= 500 && write ? UNKNOWN_WRITE
        : "";
      const text = this.redact(`Snap API ${response.status}: ${detail}${hint}`);
      // Never infer a rejection from a timeout, a mixed batch, a returned entity or a PATCH.
      const entries = init.body && !form && typeof init.body === "object" && !Array.isArray(init.body) ? Object.entries(init.body as Row) : [];
      const collection = entries.length === 1 ? entries[0][0] : undefined;
      const singular = collection === "media" ? collection : collection?.slice(0, -1);
      if (
        method === "POST" && collection && singular &&
        Array.isArray((init.body as Row)[collection]) && (init.body as Row)[collection].length === 1 &&
        Array.isArray(data[collection]) && data[collection].length === 1 && errors.length === 1 &&
        !data[collection][0][singular] && /^Error code: (E1008|E2002|E2652),/.test(errors[0].sub_request_error_reason ?? "")
      ) {
        throw new SnapValidationRejection(text, response.status);
      }
      throw new SnapApiError(text, response.status);
    }
    return data;
  }

  /**
   * Read one entity and prove it belongs to the selected ad account, walking
   * up from an ad to its ad squad and campaign when Snap does not say.
   */
  async entity(kind: string, id: string, account: string): Promise<Row> {
    this.assertAllowed(account);
    if (typeof id !== "string" || !ENTITY_ID.test(id)) throw new SnapApiError(`Invalid Snap ${kind} ID.`);
    const collection = plural(kind);
    const value = rows(
      await this.request(`/${collection}/${id}${kind === "adsquad" ? "?return_placement_v2=true" : ""}`),
      collection,
      kind,
    )[0];
    if (!value || String(value.id) !== id) throw new SnapApiError(`Snap ${kind} read returned a missing or different entity ID.`);
    let owner = value.ad_account_id;
    if (kind === "adaccount") owner = value.id;
    if (kind === "adsquad") owner = (await this.entity("campaign", value.campaign_id, account)).ad_account_id;
    if (kind === "ad") {
      await this.entity("adsquad", value.ad_squad_id, account);
      owner = account;
    }
    if (String(owner).toLowerCase() !== account.toLowerCase()) {
      throw new SnapApiError("Snap entity does not belong to the selected ad account.");
    }
    return value;
  }
}

/** Extract the cursor from Snap's `paging.next_link`, only when it points at the Snap API. */
export function nextCursor(data: Row): string | null {
  const link = data?.paging?.next_link;
  if (typeof link !== "string") return null;
  try {
    const url = new URL(link);
    return url.origin === SNAP_API_ORIGIN ? url.searchParams.get("cursor") : null;
  } catch {
    return null;
  }
}
