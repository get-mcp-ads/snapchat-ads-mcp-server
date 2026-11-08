/**
 * Client guarantees: configuration errors, the account allowlist, provider
 * error mapping, token renewal in memory, pagination, response bounds and
 * credential redaction. Every test mocks fetch; nothing reaches Snap.
 */
import { afterEach, expect, it, vi } from "vitest";
import { loadConfig, validateConfig } from "../../src/config.js";
import { SnapClient, nextCursor } from "../../src/platforms/snapchat/client.js";
import { ACCOUNT, OTHER, collect, json, native } from "./catalogue.js";

afterEach(() => vi.unstubAllGlobals());

const env = (extra: Record<string, string>) => ({ SNAPCHAT_ADS_ACCOUNT_IDS: ACCOUNT, ...extra });

it("configuration errors name the variables to set and never echo a value", () => {
  const cases: Record<string, string>[] = [
    env({}),
    env({ SNAPCHAT_ADS_REFRESH_TOKEN: "private-refresh" }),
    env({ SNAPCHAT_ADS_ACCESS_TOKEN: "private-token", SNAPCHAT_ADS_ACCOUNT_IDS: "" }),
    env({ SNAPCHAT_ADS_ACCESS_TOKEN: "private-token", SNAPCHAT_ADS_ACCOUNT_IDS: "../other" }),
    env({ SNAPCHAT_ADS_ACCESS_TOKEN: "private-token", SNAPCHAT_ADS_ENABLE_WRITES: "1" }),
    env({ SNAPCHAT_ADS_ACCESS_TOKEN: "private-token", SNAPCHAT_ADS_ENABLE_WRITES: "TRUE" }),
  ];
  for (const value of cases) {
    expect(() => loadConfig(value)).toThrow(/SNAPCHAT_ADS_/);
    try { loadConfig(value); } catch (e) {
      expect((e as Error).message).not.toContain("private-token");
      expect((e as Error).message).not.toContain("private-refresh");
    }
  }
});

it("writes stay off unless the flag is exactly true, and account IDs are normalized", () => {
  expect(loadConfig(env({ SNAPCHAT_ADS_ACCESS_TOKEN: "t" })).enableWrites).toBe(false);
  expect(loadConfig(env({ SNAPCHAT_ADS_ACCESS_TOKEN: "t", SNAPCHAT_ADS_ENABLE_WRITES: "" })).enableWrites).toBe(false);
  expect(loadConfig(env({ SNAPCHAT_ADS_ACCESS_TOKEN: "t", SNAPCHAT_ADS_ENABLE_WRITES: "true" })).enableWrites).toBe(true);
  const config = loadConfig({ SNAPCHAT_ADS_ACCESS_TOKEN: "t", SNAPCHAT_ADS_ACCOUNT_IDS: ` ${ACCOUNT.toUpperCase()}, ${ACCOUNT} ,${OTHER}` });
  expect(config.allowedAccountIds).toEqual([ACCOUNT, OTHER]);
  expect(validateConfig({ refreshToken: "r", clientId: "c", clientSecret: "s", allowedAccountIds: [ACCOUNT] }).accessToken).toBeUndefined();
});

it("refuses an account outside the allowlist before any request, for reads and writes", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const { call } = collect();
  for (const [name, args] of [
    ["snapchat_health_check", {}],
    ["snapchat_get_campaigns", {}],
    ["snapchat_get_insights", { startTime: "2026-09-01T00:00:00Z", endTime: "2026-09-02T00:00:00Z" }],
    ["snapchat_update_status", { kind: "campaign", entityId: ACCOUNT, status: "PAUSED", confirm: true }],
    ["snapchat_create_campaign", { spec: { name: "QA", start_time: "2026-09-12T00:00:00Z" } }],
  ] as const) {
    const r = await call(name, { ...args, adAccountId: OTHER });
    expect(r.error, name).toBe(true);
    expect(r.data.error).toContain("SNAPCHAT_ADS_ACCOUNT_IDS");
  }
  expect(f).not.toHaveBeenCalled();
  const api = new SnapClient({ accessToken: "x", allowedAccountIds: [ACCOUNT] });
  await expect(api.request(`/adaccounts/${OTHER}/campaigns`)).rejects.toThrow("SNAPCHAT_ADS_ACCOUNT_IDS");
  expect(f).not.toHaveBeenCalled();
});

it("accepts an allowed account written in upper case", async () => {
  const f = vi.fn().mockResolvedValue(native("adaccount", { id: ACCOUNT, timezone: "Europe/Paris", test: true }));
  vi.stubGlobal("fetch", f);
  const r = await collect().call("snapchat_health_check", { adAccountId: ACCOUNT.toUpperCase() });
  expect(r.error).toBeUndefined();
  expect(r.data).toMatchObject({ id: ACCOUNT, test: true });
  expect(f.mock.calls[0][0]).toBe(`https://adsapi.snapchat.com/v1/adaccounts/${ACCOUNT}`);
});

it("every request refuses redirects, sets a timeout and stays on Snap hosts", async () => {
  const f = vi.fn().mockResolvedValue(json({ request_status: "SUCCESS", campaigns: [], paging: {} }));
  vi.stubGlobal("fetch", f);
  await collect().call("snapchat_get_campaigns");
  const [url, init] = f.mock.calls[0];
  expect(new URL(url).origin).toBe("https://adsapi.snapchat.com");
  expect(init.redirect).toBe("error");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(init.headers.Authorization).toBe("Bearer TEST_TOKEN");
});

it("pagination passes the cursor through and returns next_cursor only for Snap links", async () => {
  const f = vi.fn().mockResolvedValue(json({
    request_status: "SUCCESS",
    campaigns: [{ sub_request_status: "SUCCESS", campaign: { id: OTHER } }],
    paging: { next_link: `https://adsapi.snapchat.com/v1/adaccounts/${ACCOUNT}/campaigns?cursor=abc%3D%3D&limit=50` },
  }));
  vi.stubGlobal("fetch", f);
  const r = await collect().call("snapchat_get_campaigns", { limit: 50, cursor: "prev+cursor" });
  expect(r.data.next_cursor).toBe("abc==");
  expect(r.data.campaigns).toHaveLength(1);
  const url = new URL(f.mock.calls[0][0]);
  expect(url.searchParams.get("cursor")).toBe("prev+cursor");
  expect(url.searchParams.get("limit")).toBe("50");
  expect(nextCursor({ paging: { next_link: "https://evil.example/v1/x?cursor=steal" } })).toBeNull();
  expect(nextCursor({ paging: {} })).toBeNull();
});

it("insights flag a partial result when Snap returns another page", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ request_status: "SUCCESS", total_stats: [], paging: { next_link: "https://adsapi.snapchat.com/next" } })));
  const r = await collect().call("snapchat_get_insights", { startTime: "2026-09-01T00:00:00Z", endTime: "2026-09-02T00:00:00Z", breakdown: "ad" });
  expect(r.data).toMatchObject({ partial: true, units: { spend: "micro currency" }, interval: "end exclusive" });
});

it("insights use the native demographic pivot and check entity ownership", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(native("campaign", { id: OTHER, ad_account_id: ACCOUNT }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS" }));
  vi.stubGlobal("fetch", f);
  await collect().call("snapchat_get_insights", { level: "campaigns", entityId: OTHER, breakdown: "ad", reportDimension: "device_os", startTime: "2026-09-01T00:00:00Z", endTime: "2026-09-02T00:00:00Z" });
  const url = new URL(f.mock.calls[1][0]);
  expect(url.pathname).toBe(`/v1/campaigns/${OTHER}/stats`);
  expect(url.searchParams.get("report_dimension")).toBe("os");
  expect(url.searchParams.has("dimension")).toBe(false);
});

it("maps provider errors with actionable hints", async () => {
  const api = new SnapClient({ accessToken: "x", allowedAccountIds: [ACCOUNT] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ request_status: "ERROR", debug_message: "Forbidden" }, 403)));
  await expect(api.request(`/adaccounts/${ACCOUNT}`)).rejects.toThrow(/Snap API 403.*snapchat-marketing-api scope/);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ request_status: "ERROR" }, 429)));
  await expect(api.request(`/adaccounts/${ACCOUNT}`)).rejects.toThrow(/rate limit.*Wait before retrying/);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ request_status: "ERROR" }, 503)));
  await expect(api.request("/campaigns", { method: "POST", body: { campaigns: [{}] } })).rejects.toThrow("outcome is unknown");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 })));
  await expect(api.request("/campaigns", { method: "POST", body: { campaigns: [{}] } })).rejects.toThrow(/not a JSON object.*outcome is unknown/);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")));
  await expect(api.request(`/adaccounts/${ACCOUNT}/campaigns`, { method: "POST", body: {} })).rejects.toThrow(/did not complete.*outcome is unknown/);
});

it("a plain-text 401 without refresh credentials is reported once, without retry", async () => {
  const f = vi.fn(async () => new Response("unauthorized", { status: 401 }));
  vi.stubGlobal("fetch", f);
  await expect(new SnapClient({ accessToken: "expired", allowedAccountIds: [ACCOUNT] }).request(`/campaigns/${OTHER}`)).rejects.toThrow("SNAPCHAT_ADS_REFRESH_TOKEN");
  expect(f).toHaveBeenCalledTimes(1);
});

it("renews the token in memory after a 401 and uses a rotated refresh token next time", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600 }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS" }))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: "third-access", expires_in: 3600 }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS" }));
  vi.stubGlobal("fetch", f);
  const api = new SnapClient({ accessToken: "old", refreshToken: "first-refresh", clientId: "id", clientSecret: "secret", allowedAccountIds: [ACCOUNT] });
  await api.request(`/adaccounts/${ACCOUNT}`);
  expect(f.mock.calls[1][0]).toBe("https://accounts.snapchat.com/login/oauth2/access_token");
  expect(f.mock.calls[1][1].redirect).toBe("error");
  const form = new URLSearchParams(f.mock.calls[1][1].body);
  expect(Object.fromEntries(form)).toEqual({ grant_type: "refresh_token", refresh_token: "first-refresh", client_id: "id", client_secret: "secret" });
  expect(f.mock.calls[2][1].headers.Authorization).toBe("Bearer new-access");
  await api.request(`/adaccounts/${ACCOUNT}`);
  expect(new URLSearchParams(f.mock.calls[4][1].body).get("refresh_token")).toBe("rotated-refresh");
  expect(f.mock.calls[5][1].headers.Authorization).toBe("Bearer third-access");
});

it("obtains a first access token from the refresh credentials, once for concurrent calls", async () => {
  const f = vi.fn(async (url: string) => url.startsWith("https://accounts.snapchat.com/")
    ? json({ access_token: "fresh", expires_in: 3600 })
    : json({ request_status: "SUCCESS" }));
  vi.stubGlobal("fetch", f);
  const api = new SnapClient({ refreshToken: "r", clientId: "id", clientSecret: "secret", allowedAccountIds: [ACCOUNT] });
  await Promise.all([api.request(`/adaccounts/${ACCOUNT}`), api.request(`/adaccounts/${ACCOUNT}/campaigns`)]);
  expect(f.mock.calls.filter(([url]) => String(url).startsWith("https://accounts.snapchat.com/"))).toHaveLength(1);
  expect(f.mock.calls.filter(([url]) => String(url).startsWith("https://adsapi.snapchat.com/")).every(([, init]) => init.headers.Authorization === "Bearer fresh")).toBe(true);
});

it("a refused renewal names the variables and leaks no secret", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ error: "invalid_grant", echoed: "secret-value refresh-value" }, 400)));
  const api = new SnapClient({ accessToken: "a", refreshToken: "refresh-value", clientId: "id", clientSecret: "secret-value", allowedAccountIds: [ACCOUNT] });
  const error = await api.request(`/adaccounts/${ACCOUNT}`).catch((e) => e as Error);
  expect(error.message).toContain("SNAPCHAT_ADS_REFRESH_TOKEN");
  expect(error.message).not.toMatch(/secret-value|refresh-value/);
});

it("redacts credentials that a provider error echoes back", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ request_status: "ERROR", debug_message: "token TEST_TOKEN rejected; Authorization: Bearer abcdefghijklmnop" }, 400)));
  const r = await collect().call("snapchat_get_pixels");
  expect(r.error).toBe(true);
  expect(r.text).not.toContain("TEST_TOKEN");
  expect(r.text).not.toContain("abcdefghijklmnop");
  expect(r.text).toContain("[REDACTED]");
});

it("bounds the response size", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < 20) controller.enqueue(chunk);
      else controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
  await expect(new SnapClient({ accessToken: "x", allowedAccountIds: [ACCOUNT] }).request(`/adaccounts/${ACCOUNT}/campaigns`)).rejects.toThrow("exceeded 16 MB");
  expect(sent).toBeLessThan(20);
});

it("rejects unsafe paths and entity IDs before any request", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const api = new SnapClient({ accessToken: "x", allowedAccountIds: [ACCOUNT] });
  for (const path of ["https://evil.example/x", "/../x", "campaigns", "/a\\b"]) await expect(api.request(path)).rejects.toThrow("Invalid Snap API path");
  await expect(api.request(`/v1/media/${OTHER}/multipart-upload-v2?action=INIT`, { originPath: true })).rejects.toThrow("regional upload path");
  await expect(api.entity("creative", "a?b=1", ACCOUNT)).rejects.toThrow("Invalid Snap creative ID");
  expect(f).not.toHaveBeenCalled();
});

it("tools without an account make no request", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const { call } = collect();
  expect((await call("snapchat_get_write_schema", { kind: "creative" })).data).toMatchObject({ kind: "creative", budgetUnit: "micro currency" });
  expect((await call("snapchat_get_setup_guide")).data.objectives).toContain("SALES");
  expect(f).not.toHaveBeenCalled();
});

it("unknown arguments are rejected", async () => {
  const r = await collect().call("snapchat_get_campaigns", { surprise: true });
  expect(r.error).toBe(true);
  expect(r.data.error).toContain("Invalid arguments");
});
