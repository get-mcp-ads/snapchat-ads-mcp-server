/**
 * Write behaviour ported from the getmcpads gateway tests (revision 3e1c2c8):
 * previews never reach Snap, creation is paused, ownership is checked before
 * any mutation and an uncertain outcome is never resent.
 */
import { afterEach, expect, it, vi } from "vitest";
import { SnapClient } from "../../src/platforms/snapchat/client.js";
import { snapCreativeAssets } from "../../src/platforms/snapchat/creatives.js";
import { validateSnapSquad } from "../../src/platforms/snapchat/validation.js";
import { ACCOUNT, OTHER, collect, json, native } from "./catalogue.js";

const campaign = OTHER;
const media = "bb427192-1670-460b-94e1-6f06d31650ed";
const spec = { name: "QA", start_time: "2027-01-01T10:00:00+01:00", end_time: "2027-01-02T10:00:00+01:00", daily_budget_micro: 20_000_000 };
const { tools, call } = collect();
afterEach(() => vi.unstubAllGlobals());

it("exposes 25 write tools, each with confirm, and keeps reads free of it", () => {
  const writes = tools.filter((t) => t.write).map((t) => t.name);
  expect(writes).toHaveLength(25);
  expect(tools.filter((t) => !t.write)).toHaveLength(21);
  expect(writes).toContain("snapchat_upload_media");
  expect(writes.some((n) => n.includes("frozen"))).toBe(false);
});

it("previews do not call the provider and creation is paused", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  for (const kind of ["campaign", "adsquad", "ad"]) {
    const args = kind === "campaign" ? { spec: { name: "QA", start_time: "2026-09-12T00:00:00Z" } }
      : kind === "adsquad" ? { parentId: campaign, spec: { name: "QA", type: "SNAP_ADS", start_time: "2026-09-12T00:00:00Z", targeting: {}, placement_v2: { config: "AUTOMATIC" }, billing_event: "IMPRESSION", optimization_goal: "IMPRESSIONS" } }
      : { parentId: campaign, spec: { name: "QA", type: "REMOTE_WEBPAGE", creative_id: media } };
    const r = await call(`snapchat_create_${kind}`, args);
    expect(r.error).toBeUndefined();
    expect(r.data.preview).toBe(true);
    expect(r.data.payload[`${kind}s`][0].status).toBe("PAUSED");
  }
  expect(f).not.toHaveBeenCalled();
});

it("rejects account overrides, bad monetary values and embedded secrets", async () => {
  vi.stubGlobal("fetch", vi.fn());
  expect((await call("snapchat_create_campaign", { spec: { name: "QA", start_time: "2026-09-12T00:00:00Z", ad_account_id: "other" } })).error).toBe(true);
  expect((await call("snapchat_update_campaign", { entityId: campaign, spec: { daily_budget_micro: 1.5 } })).error).toBe(true);
  expect((await call("snapchat_update_adsquad", { entityId: campaign, spec: { targeting: { access_token: "bad" } } })).error).toBe(true);
  expect((await call("snapchat_update_campaign", { entityId: campaign, spec: { status: "ACTIVE" } })).error).toBe(true);
});

it("blocks cross-account writes after a single read", async () => {
  const f = vi.fn().mockResolvedValue(native("campaign", { id: campaign, ad_account_id: "other" }));
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_update_campaign", { entityId: campaign, spec: { name: "QA" }, confirm: true })).error).toBe(true);
  expect(f).toHaveBeenCalledTimes(1);
});

it("PATCH only edits requested fields", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(native("campaign", { id: campaign, ad_account_id: ACCOUNT, name: "Old", status: "PAUSED" }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS" }))
    .mockResolvedValueOnce(native("campaign", { id: campaign, ad_account_id: ACCOUNT, name: "New", status: "PAUSED" }));
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_update_campaign", { entityId: campaign, spec: { name: "New" }, confirm: true });
  expect(r.error).toBeUndefined();
  expect(r.data).toMatchObject({ applied: true, verification: { confirmed: true } });
  const [url, init] = f.mock.calls[1];
  expect(url).toBe(`https://adsapi.snapchat.com/v1/adaccounts/${ACCOUNT}/campaigns/${campaign}`);
  expect(init.method).toBe("PATCH");
  expect(init.headers["Content-Type"]).toBe("application/json-patch+json");
  expect(JSON.parse(init.body)).toEqual([{ op: "replace", path: "/name", value: "New" }]);
});

it("renames a campaign with native zero budget defaults without resetting them", async () => {
  const value = { id: campaign, ad_account_id: ACCOUNT, name: "Before", daily_budget_micro: 0, lifetime_spend_cap_micro: 0, status: "PAUSED" };
  const f = vi.fn().mockResolvedValueOnce(native("campaign", value)).mockResolvedValueOnce(json({ request_status: "SUCCESS" })).mockResolvedValueOnce(native("campaign", { ...value, name: "After" }));
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_update_campaign", { entityId: campaign, spec: { name: "After" }, confirm: true })).data).toMatchObject({ applied: true, verification: { confirmed: true } });
  expect(JSON.parse(f.mock.calls[1][1].body)).toEqual([{ op: "replace", path: "/name", value: "After" }]);
});

it("rename tools preview without network and patch only the name", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const preview = await call("snapchat_rename_adsquad", { adSquadId: campaign, name: "Spring" });
  expect(preview.data).toMatchObject({ applied: false, preview: true, change: { target: campaign, newName: "Spring" } });
  expect(f).not.toHaveBeenCalled();
});

it("renames the ad account by writing back the account as read", async () => {
  const org = "11111111-2222-4333-8444-555555555555";
  const accountRow = { id: ACCOUNT, organization_id: org, name: "Old", currency: "EUR", timezone: "Europe/Paris", created_at: "x", updated_at: "y" };
  const f = vi.fn()
    .mockResolvedValueOnce(native("adaccount", accountRow))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS", adaccounts: [{ sub_request_status: "SUCCESS", adaccount: { ...accountRow, name: "New" } }] }))
    .mockResolvedValueOnce(native("adaccount", { ...accountRow, name: "New" }));
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_rename_ad_account", { name: "New", confirm: true });
  expect(r.data).toMatchObject({ applied: true, verification: { confirmed: true } });
  const [url, init] = f.mock.calls[1];
  expect(url).toBe(`https://adsapi.snapchat.com/v1/organizations/${org}/adaccounts`);
  expect(init.method).toBe("PUT");
  const sent = JSON.parse(init.body).adaccounts[0];
  expect(sent).toEqual({ id: ACCOUNT, organization_id: org, name: "New", currency: "EUR", timezone: "Europe/Paris" });
});

it("status activation previews as able to spend and patches only status", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const preview = await call("snapchat_update_status", { kind: "ad", entityId: campaign, status: "ACTIVE" });
  expect(preview.data).toMatchObject({ preview: true, activationMaySpend: true, changes: { status: "ACTIVE" } });
  expect((await call("snapchat_update_status", { kind: "ad", entityId: campaign, status: "PAUSED" })).data.activationMaySpend).toBe(false);
});

it("reports per-item HTTP 200 errors without retrying writes", async () => {
  const f = vi.fn().mockResolvedValue(json({ request_status: "SUCCESS", campaigns: [{ sub_request_status: "ERROR", sub_request_error_reason: "Invalid budget" }] }));
  vi.stubGlobal("fetch", f);
  await expect(new SnapClient({ accessToken: "x", allowedAccountIds: [ACCOUNT] }).request("/campaigns", { method: "POST", body: {} })).rejects.toThrow("Invalid budget");
  expect(f).toHaveBeenCalledTimes(1);
});

it("treats request_status ERROR on HTTP 200 as a failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ request_status: "ERROR", debug_message: "Bad request", error_code: "E1001" })));
  const r = await call("snapchat_get_campaigns");
  expect(r.error).toBe(true);
  expect(r.data.error).toContain("Bad request");
});

it.each([
  { start_time: "2027-01-01" }, { end_time: "2026-01-01T00:00:00Z" }, { daily_budget_micro: 0 },
  { daily_budget_micro: 1.1 }, { pacing_level: "CAMPAIGN" }, { lifetime_spend_cap_micro: -1 },
])("rejects malformed schedule/budget settings before network: %j", async (change) => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_create_campaign", { spec: { ...spec, ...change }, confirm: true })).error).toBe(true);
  expect(f).not.toHaveBeenCalled();
});

it("rejects free text in a Collection interaction-zone CTA before network", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const zone = { name: "QA Collection", headline: "Notre sélection", creative_element_ids: [ACCOUNT, campaign, ACCOUNT, campaign] };
  expect((await call("snapchat_create_interaction_zone", { spec: zone, confirm: true })).error).toBe(true);
  expect(f).not.toHaveBeenCalled();
  expect((await call("snapchat_create_interaction_zone", { spec: { ...zone, headline: "MORE" } })).data.preview).toBe(true);
});

it("keeps Smart Budgets shared fields exact and forbids extra squad budgets", () => {
  const parent = { pacing_level: "CAMPAIGN", shared_properties: { shared_optimization_goal: "IMPRESSIONS", shared_ad_squad_bid_strategy: "AUTO_BID" } };
  const item = { optimization_goal: "IMPRESSIONS", bid_strategy: "AUTO_BID" };
  expect(() => validateSnapSquad(item, parent)).not.toThrow();
  expect(() => validateSnapSquad({ ...item, daily_budget_micro: 1_000_000 }, parent)).toThrow("omit independent");
  expect(() => validateSnapSquad({ ...item, optimization_goal: "SWIPES" }, parent)).toThrow("optimization_goal");
  expect(() => validateSnapSquad(item, {})).toThrow("explicit budget");
});

it("refuses a different ID even when Snap returns the requested account owner", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => native("campaign", { id: ACCOUNT, ad_account_id: ACCOUNT })));
  await expect(new SnapClient({ accessToken: "x", allowedAccountIds: [ACCOUNT] }).entity("campaign", campaign, ACCOUNT)).rejects.toThrow("different entity");
});

it("verifies created campaign fields and retains the original envelope", async () => {
  const value = { ...spec, id: campaign, ad_account_id: ACCOUNT, status: "PAUSED" };
  const f = vi.fn()
    .mockResolvedValueOnce(native("adaccount", { id: ACCOUNT }))
    .mockResolvedValueOnce(native("campaign", value))
    .mockResolvedValueOnce(native("campaign", { ...value, start_time: "2027-01-01T09:00:00Z" }));
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_create_campaign", { spec, confirm: true });
  expect(r.data).toMatchObject({ applied: true, campaigns: [{ campaign: { id: campaign } }], verification: { confirmed: true } });
  expect(JSON.parse(f.mock.calls[1][1].body).campaigns[0]).toMatchObject({ status: "PAUSED", ad_account_id: ACCOUNT });
});

it.each(["timeout", "changed"])("preserves an acknowledged ID after %s readback without another POST", async (failure) => {
  const value = { ...spec, id: campaign, ad_account_id: ACCOUNT, status: "PAUSED" };
  const f = vi.fn().mockResolvedValueOnce(native("adaccount", { id: ACCOUNT })).mockResolvedValueOnce(native("campaign", value));
  if (failure === "timeout") f.mockRejectedValueOnce(new Error("timeout"));
  else f.mockResolvedValueOnce(native("campaign", { ...value, status: "ACTIVE", daily_budget_micro: 50_000_000 }));
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_create_campaign", { spec, confirm: true });
  expect(r.data).toMatchObject({ applied: true, result: { campaigns: [{ campaign: { id: campaign } }] }, verification: { confirmed: false } });
  expect(f.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
});

it("records an explicit single-create validation rejection as not applied", async () => {
  const f = vi.fn(async (_url: string, init: any) => init.method === "GET"
    ? native("adaccount", { id: ACCOUNT, test: true })
    : json({ request_status: "PARTIAL", campaigns: [{ sub_request_status: "ERROR", sub_request_error_reason: "Error code: E1008, message: Request cannot be processed due to validation error : [below the minimum value]" }] }));
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_create_campaign", { spec, confirm: true });
  expect(r.error).toBe(true);
  expect(r.data).toMatchObject({ applied: false, outcome: "rejected" });
  expect(f.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
});

it.each(["returned entity", "timeout", "mixed response"])("retains an uncertain %s without marking it safely rejected", async (condition) => {
  const f = vi.fn(async (_url: string, init: any) => {
    if (init.method === "GET") return native("adaccount", { id: ACCOUNT, test: true });
    if (condition === "timeout") throw new Error("timeout");
    const failed: any = { sub_request_status: "ERROR", sub_request_error_reason: "Error code: E1008, message: validation error" };
    if (condition === "returned entity") failed.campaign = { id: campaign };
    return json({ request_status: "PARTIAL", campaigns: [failed, ...(condition === "mixed response" ? [{ sub_request_status: "SUCCESS", campaign: { id: campaign } }] : [])] });
  });
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_create_campaign", { spec, confirm: true });
  expect(r.error).toBe(true);
  expect(r.data).not.toHaveProperty("outcome");
  if (condition === "timeout") expect(r.data.error).toContain("outcome is unknown");
  expect(f.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
});

it("preflights the required public profile and native CTA before creating a creative", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const creative = { name: "Test", type: "WEB_VIEW", top_snap_media_id: campaign, web_view_properties: { url: "https://example.com" } };
  let r = await call("snapchat_create_creative", { spec: creative, confirm: true });
  expect(r.error).toBe(true);
  expect(r.text).toContain("profile_properties.profile_id");
  r = await call("snapchat_create_creative", { spec: { ...creative, profile_properties: { profile_id: campaign }, call_to_action: "LEARN_MORE" }, confirm: true });
  expect(r.error).toBe(true);
  expect(r.text).toContain("native WEB_VIEW call_to_action");
  expect(f).not.toHaveBeenCalled();
  expect((await call("snapchat_create_creative", { spec: { ...creative, profile_properties: { profile_id: campaign }, call_to_action: "MORE" } })).data.preview).toBe(true);
});

it("customer-list previews hide hashes and reject raw identifiers without network calls", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const args = { segmentId: "12345", action: "add", schema: "EMAIL_SHA256", hashes: ["a".repeat(64)] };
  const r = await call("snapchat_update_audience_users", args);
  expect(r.data.count).toBe(1);
  expect(r.text).not.toContain("a".repeat(64));
  const raw = await call("snapchat_update_audience_users", { ...args, hashes: ["person@example.com"], confirm: true });
  expect(raw.error).toBe(true);
  expect(raw.text).not.toContain("person@example.com");
  expect(f).not.toHaveBeenCalled();
});

it.each(["add", "remove"])("customer-list %s sends the native hashed row format after ownership validation", async (action) => {
  const f = vi.fn()
    .mockResolvedValueOnce(native("segment", { id: "12345", ad_account_id: ACCOUNT, source_type: "FIRST_PARTY" }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS" }));
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_update_audience_users", { segmentId: "12345", action, schema: "EMAIL_SHA256", hashes: ["a".repeat(64)], confirm: true })).error).toBeUndefined();
  expect(f.mock.calls[1][0]).toBe("https://adsapi.snapchat.com/v1/segments/12345/users");
  expect(f.mock.calls[1][1].method).toBe(action === "add" ? "POST" : "DELETE");
  expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ users: [{ schema: ["EMAIL_SHA256"], data: [["a".repeat(64)]] }] });
});

it("cross-account lookalike seeds never reach a mutation", async () => {
  const f = vi.fn().mockResolvedValue(native("segment", { id: "12345", ad_account_id: OTHER, source_type: "FIRST_PARTY" }));
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_create_lookalike", { name: "QA", seedSegmentId: "12345", countries: ["FR"], confirm: true })).error).toBe(true);
  expect(f).toHaveBeenCalledTimes(1);
});

it("native segment_id arrays are checked before targeting changes", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(native("adsquad", { id: OTHER, ad_account_id: ACCOUNT, campaign_id: campaign }))
    .mockResolvedValueOnce(native("campaign", { id: campaign, ad_account_id: ACCOUNT, daily_budget_micro: 5_000_000 }))
    .mockResolvedValueOnce(native("campaign", { id: campaign, ad_account_id: ACCOUNT, daily_budget_micro: 5_000_000 }))
    .mockResolvedValueOnce(native("segment", { id: "12345", ad_account_id: "foreign" }));
  vi.stubGlobal("fetch", f);
  const r = await call("snapchat_update_adsquad", { entityId: OTHER, spec: { targeting: { segments: [{ segment_id: ["12345"], operation: "EXCLUDE" }] }, daily_budget_micro: 5_000_000 }, confirm: true });
  expect(r.error).toBe(true);
  expect(r.data.error).toContain("does not belong");
  expect(f.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
});

it("multipart upload uses the Europe origin path and sends the exact part", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(native("media", { id: media, ad_account_id: ACCOUNT, type: "VIDEO" }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS" }));
  vi.stubGlobal("fetch", f);
  const path = `/europe/v1/media/${media}/multipart-upload-v2?action=ADD`;
  expect((await call("snapchat_upload_media_part", { mediaId: media, uploadId: OTHER, addPath: path, partNumber: 1, base64: btoa("test"), confirm: true })).error).toBeUndefined();
  expect(f.mock.calls[1][0]).toBe("https://adsapi.snapchat.com" + path);
  expect(await f.mock.calls[1][1].body.get("file").text()).toBe("test");
  expect(f.mock.calls[1][1].body.get("part_number")).toBe("1");
});

it.each([
  "https://evil.example/upload",
  `/europe/v1/media/${OTHER}/multipart-upload-v2?action=ADD`,
  `/europe/v1/media/${media}/multipart-upload-v2?action=FINALIZE`,
  `/europe/v1/media/${media}/multipart-upload-v2?action=ADD&other=1`,
])("rejects unsafe or mismatched multipart path %s", async (addPath) => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_upload_media_part", { mediaId: media, uploadId: OTHER, addPath, partNumber: 1, base64: btoa("test"), confirm: true })).error).toBe(true);
  expect(f).not.toHaveBeenCalled();
});

it("multipart initialization rejects insufficient capacity before calling Snap", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  expect((await call("snapchat_init_media_upload", { mediaId: media, fileName: "qa.mp4", fileSize: 25 * 1024 * 1024, numberOfParts: 3, confirm: true })).error).toBe(true);
  expect(f).not.toHaveBeenCalled();
});

it("direct upload previews the decoded size and sends the bytes only on confirm", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(native("media", { id: media, ad_account_id: ACCOUNT, type: "IMAGE" }))
    .mockResolvedValueOnce(json({ request_status: "SUCCESS", result: { id: media } }));
  vi.stubGlobal("fetch", f);
  const args = { mediaId: media, fileName: "hero.png", mimeType: "image/png", base64: btoa("pngbytes") };
  expect((await call("snapchat_upload_media", args)).data).toMatchObject({ preview: true, bytes: 8 });
  expect(f).not.toHaveBeenCalled();
  expect((await call("snapchat_upload_media", { ...args, base64: "not base64 !" , confirm: true })).error).toBe(true);
  expect(f).not.toHaveBeenCalled();
  const r = await call("snapchat_upload_media", { ...args, confirm: true });
  expect(r.error).toBeUndefined();
  expect(f.mock.calls[1][0]).toBe(`https://adsapi.snapchat.com/v1/media/${media}/upload`);
  expect(await f.mock.calls[1][1].body.get("file").text()).toBe("pngbytes");
});

it("lead form schema requires the native default end page", async () => {
  const leadSpec = { name: "QA", title: "QA", description: "QA", form_fields: [{ type: "EMAIL" }], default_end_page: { headline: "Thank you", description: "Test complete" } };
  const r = await call("snapchat_create_lead_generation_form", { spec: leadSpec });
  expect(r.error).toBeUndefined();
  expect(r.data.payload.lead_generation_forms[0].default_end_page).toEqual(leadSpec.default_end_page);
  expect((await call("snapchat_create_lead_generation_form", { spec: { ...leadSpec, default_end_page: undefined } })).error).toBe(true);
});

it("creative listing resolves Story and Collection components with ownership checks", async () => {
  const entities: Record<string, any> = {
    "creative:story": { id: "story", type: "COMPOSITE", composite_properties: { creative_ids: ["child"] } },
    "creative:child": { id: "child", type: "WEB_VIEW", top_snap_media_id: "image", web_view_properties: { url: "https://example.com" } },
    "creative:collection": { id: "collection", type: "COLLECTION", top_snap_media_id: "image", collection_properties: { interaction_zone_id: "zone" } },
    "interaction_zone:zone": { creative_element_ids: ["element"] },
    "creative_element:element": { button_properties: { button_overlay_media_id: "tile" } },
    "media:image": { id: "image", type: "IMAGE", download_link: "https://example.com/image.png" },
    "media:tile": { id: "tile", type: "IMAGE", download_link: "https://example.com/tile.png" },
  };
  const entity = vi.fn(async (kind: string, id: string, scope: string) => {
    expect(scope).toBe(ACCOUNT);
    return entities[kind + ":" + id];
  });
  const result = await snapCreativeAssets({ entity } as unknown as SnapClient, ACCOUNT, [{ id: "a", creative_id: "story" }, { id: "b", creative_id: "collection" }]);
  expect(result.assets.map((a) => a.id)).toEqual(["a/image", "b/image", "b/tile"]);
  expect(result.assets[0].landingPageUrl).toBe("https://example.com");
  expect(result.warnings).toEqual([]);
  expect(entity.mock.calls.filter(([kind, id]) => kind === "media" && id === "image")).toHaveLength(1);
});

it("creative listing reports inaccessible child assets instead of exposing them", async () => {
  const entity = vi.fn()
    .mockResolvedValueOnce({ id: "story", composite_properties: { creative_ids: ["foreign"] } })
    .mockRejectedValueOnce(new Error("not owned by selected account"));
  const result = await snapCreativeAssets({ entity } as unknown as SnapClient, ACCOUNT, [{ id: "a", creative_id: "story" }]);
  expect(result.assets).toEqual([]);
  expect(result.warnings[0]).toContain("not owned");
});
