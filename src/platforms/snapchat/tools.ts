/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native Snapchat tools ported from the getmcpads gateway. Names, schemas and
 * write semantics follow the gateway; hosted features stay out (see SOURCE_SYNC.md).
 */
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { ToolShape } from "../../tool-quality.js";
import { SnapClient, SnapValidationRejection, nextCursor, plural, rows, type Row } from "./client.js";
import { snapCreativeAssets } from "./creatives.js";
import { SNAP_DOCS } from "./hosts.js";
import { SNAP_CREATIVE_CTAS, validateSnapCreative, validateSnapSettings, validateSnapSquad, verifiedSnapWrite } from "./validation.js";

export type Collector = {
  tool(name: string, description: string, shape: ToolShape, handler: (args: Row) => Promise<unknown>): void;
};
type Register = (name: string, description: string, shape: ToolShape, fn: (a: Row) => Promise<unknown>) => void;

const id = z.string().uuid().describe("Native Snapchat entity UUID.");
const account = {
  adAccountId: z.string().uuid().describe("Snapchat ad account UUID listed in SNAPCHAT_ADS_ACCOUNT_IDS; never an organization ID."),
};
const page = {
  limit: z.number().int().min(1).max(1000).default(100).describe("Maximum entities per page, 1 to 1000."),
  cursor: z.string().max(2000).optional().describe("Opaque cursor from the previous response's next_cursor. Omit on the first request."),
};
const confirm = z.boolean().default(false).describe("False previews only. True applies the previewed change, after the user approved it.");
const native = z
  .record(z.unknown())
  .describe("Native Snap fields; budgets are integer micro currency units (1 currency unit = 1,000,000). Call snapchat_get_write_schema first.");
const segmentId = z.union([id, z.string().regex(/^\d{1,30}$/)]).describe("Native audience segment ID (UUID or numeric string).");

const kinds = ["campaign", "adsquad", "ad", "creative", "media", "segment", "creative_element", "interaction_zone", "lead_generation_form"] as const;
type Kind = (typeof kinds)[number];

const spec: Record<Kind, { parent: string; fields: string[]; required: string[] }> = {
  campaign: {
    parent: "ad_account_id",
    fields: ["name", "start_time", "end_time", "daily_budget_micro", "lifetime_spend_cap_micro", "objective", "objective_v2_properties", "buy_model", "measurement_spec", "regulations", "pacing_level", "shared_properties", "mobile_app_properties", "product_properties", "reserved_type"],
    required: ["name", "start_time"],
  },
  adsquad: {
    parent: "campaign_id",
    fields: ["name", "type", "start_time", "end_time", "targeting", "placement_v2", "billing_event", "optimization_goal", "bid_strategy", "bid_micro", "daily_budget_micro", "lifetime_budget_micro", "delivery_constraint", "event_sources", "pixel_id", "pacing_type", "conversion_window", "skadnetwork_properties", "product_properties", "campaign_budget_optimization_properties", "brand_safety_config", "forced_view_setting", "cap_and_exclusion_config", "ad_scheduling_config", "child_ad_type", "story_ad_creative_type"],
    required: ["name", "type", "start_time", "targeting", "placement_v2", "billing_event", "optimization_goal"],
  },
  ad: { parent: "ad_squad_id", fields: ["name", "type", "creative_id"], required: ["name", "type", "creative_id"] },
  creative: {
    parent: "ad_account_id",
    fields: ["name", "type", "top_snap_media_id", "headline", "brand_name", "call_to_action", "web_view_properties", "app_install_properties", "deep_link_properties", "profile_properties", "shareable", "ad_to_place_properties", "ad_to_lens_properties", "ad_to_call_properties", "ad_to_message_properties", "preview_properties", "preview_creative_id", "composite_properties", "collection_properties", "lead_generation_form_id", "render_type", "dynamic_render_properties", "top_snap_crop_position", "forced_view_eligibility", "ad_product", "chat_properties"],
    required: ["name", "type"],
  },
  media: { parent: "ad_account_id", fields: ["name", "type", "ai_content_source"], required: ["name", "type"] },
  creative_element: {
    parent: "ad_account_id",
    fields: ["name", "type", "interaction_type", "description", "title", "button_properties", "web_view_properties", "app_install_properties", "deep_link_properties"],
    required: ["name", "type", "interaction_type", "button_properties"],
  },
  interaction_zone: { parent: "ad_account_id", fields: ["name", "headline", "creative_element_ids"], required: ["name", "headline", "creative_element_ids"] },
  lead_generation_form: {
    parent: "ad_account_id",
    fields: ["name", "title", "description", "privacy_policy_url", "form_fields", "legal_disclosures", "strategy_type", "default_end_page", "banner_media_id", "logic_type"],
    required: ["name", "title", "description", "form_fields", "default_end_page"],
  },
  segment: {
    parent: "ad_account_id",
    fields: ["name", "description", "source_type", "retention_in_days", "creation_spec", "prefill", "pixel_id", "pixel_spec_object", "mobile_metadata", "engagement_specs", "source_subtype"],
    required: ["name", "source_type"],
  },
};

const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 32 * CHUNK_BYTES;

const out = (data: unknown, isError = false) => ({
  ...(isError ? { isError: true } : {}),
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return "Invalid arguments: " + error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/** Validate strictly, enforce the account allowlist before any request, and never leak a credential. */
function registrar(c: Collector, api: SnapClient): Register {
  return (name, description, shape, fn) => {
    c.tool(name, description, shape, async (raw) => {
      try {
        const a = z.object(shape).strict().parse(raw ?? {});
        if (typeof a.adAccountId === "string") {
          a.adAccountId = a.adAccountId.toLowerCase();
          api.assertAllowed(a.adAccountId);
        }
        return out(await fn(a));
      } catch (e) {
        return out({
          error: api.redact(describeError(e)),
          ...(e instanceof SnapValidationRejection ? { applied: false, outcome: "rejected" } : {}),
        }, true);
      }
    });
  };
}

function forbidSecrets(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error("Specification is too deeply nested.");
  if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (/^(access_token|refresh_token|client_secret|authorization|__proto__|constructor|prototype)$/i.test(key))
        throw new Error("Forbidden specification field.");
      forbidSecrets(v, depth + 1);
    }
}

function payload(kind: Kind, value: Row, create: boolean): Row {
  forbidSecrets(value);
  for (const key of Object.keys(value))
    if (!spec[kind].fields.includes(key)) throw new Error(`Unsupported ${kind} field: ${key}. Use snapchat_get_write_schema.`);
  if (create)
    for (const key of spec[kind].required)
      if (value[key] === undefined || value[key] === "") throw new Error(`Missing ${kind} field: ${key}`);
  for (const [key, val] of Object.entries(value))
    if (key.endsWith("_micro") && (typeof val !== "number" || !Number.isSafeInteger(val) || val < 0))
      throw new Error(`${key} must be a nonnegative integer in micro currency.`);
  validateSnapSettings(kind, value);
  if (kind === "creative") validateSnapCreative(value, create);
  return { ...value };
}

function listed(data: Row): Row {
  return { ...data, next_cursor: nextCursor(data) };
}

const query = (a: Row) =>
  new URLSearchParams({ limit: String(a.limit), ...(a.cursor ? { cursor: a.cursor } : {}) });

function renamePreview(action: string, target: string, newName: string) {
  return {
    applied: false,
    preview: true,
    action,
    change: { target, newName },
    message: "Preview only, nothing was changed. Repeat the same call with confirm: true to apply this rename to the live account.",
  };
}

const PREVIEW_NOTE = "Preview only, nothing was sent to Snap. Ask the user to approve these exact values, then repeat with confirm: true.";

export function registerSnapReads(c: Collector, api: SnapClient): void {
  const register = registrar(c, api);
  register("snapchat_health_check", "Read the selected Snapchat ad account, permissions-visible metadata, timezone, currency and test flag. Test accounts cannot serve ads.", account,
    (a) => api.entity("adaccount", a.adAccountId, a.adAccountId));

  for (const kind of kinds)
    register(`snapchat_get_${plural(kind)}`,
      `List Snapchat ${plural(kind).replaceAll("_", " ")} in the selected account, retaining full native configuration and pagination (next_cursor). An ad squad is an ad group/ad set.`,
      { ...account, ...page },
      async (a) => listed(await api.request(`/adaccounts/${a.adAccountId}/${plural(kind)}?${query(a)}`)));

  register("snapchat_get_media_status", "Read this account-owned media and its native processing state. Only ready:true permits creative creation; an accepted upload alone is insufficient.",
    { ...account, mediaId: id.describe("Media UUID created with snapchat_create_media.") },
    async (a) => {
      const media = await api.entity("media", a.mediaId, a.adAccountId);
      return { mediaId: media.id, status: media.media_status, ready: media.media_status === "READY", failed: ["FAILED", "ERROR", "REJECTED"].includes(media.media_status), media };
    });

  register("snapchat_list_ad_creatives",
    "Resolve ad-linked Snapchat images/videos, Story children and Collection tiles with business names, native IDs and fresh media URLs. Incomplete formats/media are reported. No performance is inferred. Media URLs are short-lived links from Snap; this server does not download them.",
    {
      ...account,
      adIds: z.array(id).min(1).max(60).optional().describe("Specific ad UUIDs to resolve. Omit to resolve the first ads of the account."),
      limit: z.number().int().min(1).max(60).default(24).describe("Ads to read when adIds is omitted, 1 to 60."),
    },
    async (a) => {
      const inventory = a.adIds ? null : await api.request(`/adaccounts/${a.adAccountId}/ads?limit=${a.limit}`);
      const ads: Row[] = [];
      // Sequential on purpose: Snap allows about 10 requests per second per token.
      if (a.adIds) for (const adId of a.adIds as string[]) ads.push(await api.entity("ad", adId, a.adAccountId));
      else ads.push(...rows(inventory!, "ads", "ad"));
      const { assets, warnings } = await snapCreativeAssets(api, a.adAccountId, ads);
      return { assets, warnings, truncated: Boolean(inventory?.paging?.next_link), paging: inventory?.paging };
    });

  register("snapchat_get_targeting",
    "Read configured ad squad targeting, audiences, exclusions, demographics, geo and placements. Missing fields are unknown, not proof of broad targeting. Performance breakdowns describe delivery, not configured targeting.",
    { ...account, adsquadId: id.describe("Ad squad UUID in the selected account.") },
    async (a) => ({
      adsquad: await api.entity("adsquad", a.adsquadId, a.adAccountId),
      interpretation: "Only fields returned by Snap are known. Targeting configuration is not actual reached audience.",
    }));

  register("snapchat_get_entity", "Read a campaign, ad squad, ad, creative, media, segment, creative element, interaction zone or lead form with verified account ownership.",
    {
      ...account,
      kind: z.enum(kinds).describe("Entity type to read."),
      entityId: z.union([id, z.string().regex(/^\d{1,30}$/)]).describe("Entity UUID, or the numeric ID of an audience segment."),
    },
    (a) => api.entity(a.kind, a.entityId, a.adAccountId));

  register("snapchat_get_write_schema",
    "Discover implemented Snapchat creation/edit fields, required fields and preview rules. These are the fields this server accepts, not an exhaustive Snap API schema.",
    { kind: z.enum(kinds).describe("Entity type whose writable fields to describe.") },
    async (a) => ({
      kind: a.kind,
      ...spec[a.kind as Kind],
      status: "Campaigns, ad squads and ads are created PAUSED. Use snapchat_update_status to activate explicitly.",
      budgetUnit: "micro currency",
      nestedObjects: "An edit to a nested object replaces the whole object. Read the entity first and send the complete object.",
      ...(a.kind === "interaction_zone" ? { headline: "A native Web View CTA code such as MORE or SHOP_NOW, not free text.", headlineValues: SNAP_CREATIVE_CTAS.WEB_VIEW } : {}),
      ...(a.kind === "creative" ? { publicProfile: "profile_properties.profile_id is required for new creatives except PREVIEW; use a profile authorized for this account.", callToActions: SNAP_CREATIVE_CTAS } : {}),
      documentation: `${SNAP_DOCS}/introduction`,
    }));

  register("snapchat_get_insights",
    "Read native Snapchat stats with explicit time interval (end exclusive), granularity and optional entity breakdown. Spend and monetary conversion values are micro currency. Empty test-account results are not live performance evidence. partial:true means Snap returned another page of rows.",
    {
      ...account,
      level: z.enum(["adaccounts", "campaigns", "adsquads", "ads"]).default("adaccounts").describe("Reporting level. Any level other than adaccounts needs entityId."),
      entityId: id.optional().describe("Campaign, ad squad or ad UUID for that reporting level."),
      startTime: z.string().datetime({ offset: true }).describe("Interval start, ISO timestamp with offset. Align DAY intervals to midnight in the account timezone."),
      endTime: z.string().datetime({ offset: true }).describe("Interval end, exclusive, ISO timestamp with offset."),
      granularity: z.enum(["TOTAL", "DAY", "HOUR"]).default("TOTAL").describe("Time bucketing of the returned stats."),
      fields: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1).max(100).default(["spend"]).describe("Native stats fields, such as spend, impressions or swipes. See snapchat://reporting-fields."),
      breakdown: z.enum(["campaign", "adsquad", "ad"]).optional().describe("Optional entity breakdown below the reporting level."),
      reportDimension: z.enum(["age", "gender", "country", "region", "dma", "device_os", "interest"]).optional().describe("Optional delivery audience pivot. Describes delivery, not configured targeting."),
    },
    async (a) => {
      if (Date.parse(a.startTime) >= Date.parse(a.endTime)) throw new Error("endTime must be after startTime (exclusive).");
      const entity = a.level === "adaccounts" ? a.adAccountId : a.entityId;
      if (!entity) throw new Error("entityId required for this reporting level.");
      if (a.level !== "adaccounts") await api.entity(a.level.slice(0, -1), entity, a.adAccountId);
      const q = new URLSearchParams({
        start_time: a.startTime,
        end_time: a.endTime,
        granularity: a.granularity,
        fields: a.fields.join(","),
        ...(a.breakdown ? { breakdown: a.breakdown } : {}),
        ...(a.reportDimension ? { report_dimension: ({ device_os: "os", interest: "lifestyle_category" } as Row)[a.reportDimension] ?? a.reportDimension } : {}),
      });
      const data = await api.request(`/${a.level}/${entity}/stats?${q}`);
      return {
        units: { spend: "micro currency" },
        interval: "end exclusive",
        ...(data.paging?.next_link ? { partial: true, note: "Snap returned another page of rows. These totals do not cover every entity." } : {}),
        data,
      };
    });

  register("snapchat_get_mobile_apps", "Read Snap App IDs associated with the selected ad account before creating app promotion campaigns or mobile retargeting audiences.", { ...account },
    (a) => api.request(`/adaccounts/${a.adAccountId}/mobile_apps`));

  register("snapchat_get_pixels", "Read the pixels associated with the selected account before configuring conversion optimization or website audiences.", { ...account },
    (a) => api.request(`/adaccounts/${a.adAccountId}/pixels`));

  register("snapchat_get_targeting_specs",
    "Read separately stored targeting specs, including configurations exceeding 500 criteria. These can be omitted from the ordinary ad squad response.",
    { ...account, adsquadId: id.describe("Ad squad UUID in the selected account."), ...page },
    async (a) => {
      await api.entity("adsquad", a.adsquadId, a.adAccountId);
      return listed(await api.request(`/adsquads/${a.adsquadId}/targeting_specs?${query(a)}`));
    });

  register("snapchat_get_targeting_options",
    "Discover native targeting values before editing: countries, regions, languages, genders, interests and devices. Retains pagination; do not invent category IDs.",
    {
      ...account,
      category: z.enum(["countries", "regions", "metros", "postal_codes", "languages", "genders", "age_groups", "interests", "devices"]).describe("Targeting catalog to read."),
      countryCode: z.string().regex(/^[a-zA-Z]{2}$/).optional().describe("Two-letter country code, required for regions, metros and postal codes."),
      ...page,
    },
    async (a) => {
      const paths: Row = {
        countries: "geo/country",
        languages: "demographics/languages",
        genders: "demographics/gender",
        age_groups: "demographics/age_group",
        interests: "v1/interests/scls",
        devices: "device/os_type",
      };
      let path = paths[a.category];
      if (!path) {
        if (!a.countryCode) throw new Error("countryCode is required for this category.");
        path = `geo/${a.countryCode.toLowerCase()}/${({ regions: "region", metros: "metro", postal_codes: "postal_code" } as Row)[a.category]}`;
      }
      await api.entity("adaccount", a.adAccountId, a.adAccountId);
      return listed(await api.request(`/targeting/${path}?${query(a)}`));
    });

  register("snapchat_get_setup_guide",
    "Read Snapchat campaign objectives, audience workflows, creative format prerequisites and explicit limitations. Implementation is not proof of account eligibility or live delivery. Use before claiming all features are available.",
    {},
    async () => ({
      objectives: ["AWARENESS_AND_ENGAGEMENT", "TRAFFIC", "SALES", "LEADS", "APP_PROMOTION"],
      workflow: [
        "snapchat_get_write_schema",
        "snapchat_create_campaign (PAUSED)",
        "snapchat_create_adsquad (PAUSED)",
        "snapchat_create_media, then snapchat_upload_media or the multipart upload tools",
        "snapchat_get_media_status until ready:true",
        "snapchat_create_creative",
        "snapchat_create_ad (PAUSED)",
        "snapchat_update_status only after explicit activation",
      ],
      audiences: {
        customerLists: "snapchat_create_segment FIRST_PARTY; snapchat_update_audience_users accepts normalized SHA-256 hashes only; read targetable_status before use",
        lookalikes: "snapchat_create_lookalike requires a seed segment owned by the selected account; insufficient seed size can prevent readiness",
        retargeting: "snapchat_create_segment with PIXEL pixel_spec_object, MOBILE mobile_metadata, or ENGAGEMENT engagement_specs; requires the corresponding accessible event source",
        inclusionExclusion: "snapchat_update_adsquad spec.targeting.segments; read existing targeting first because nested objects are replaced",
      },
      prerequisites: {
        sales: "A valid accessible pixel/event source and conversion events for conversion optimization.",
        appPromotion: "Advertiser-owned store app identifiers; Snap App ID/MMP/SKAN configuration where required.",
        leads: "WEB_VIEW for external forms, or snapchat_create_lead_generation_form with default_end_page, then reference its ID in a LEAD_GENERATION creative.",
        story: "COMPOSITE creative with child creative IDs; PREVIEW required for Discover placement.",
        collection: "Four or more creative elements combined into an interaction zone.",
        lens: "An accessible Lens asset prepared using Snap tools.",
        dynamic: "An accessible product catalog/set and dynamic template.",
      },
      uploads: { directImageMaxBytes: 5_000_000, directVideoMaxBytes: 10 * 1024 * 1024, multipartMaxBytes: MAX_UPLOAD_BYTES, partMaxBytes: CHUNK_BYTES, maxParts: 32 },
      limits: [
        "Test accounts do not establish delivery, attribution or nonzero performance accuracy.",
        "App, Lens, catalog, lead-form and seed-audience availability are external prerequisites, not inferred from tool availability.",
        "Reserved inventory and provider-restricted combinations may require Ads Manager or Snap enablement.",
        "URL imports, local file uploads, catalog/feed authoring and Lens authoring are not implemented. Uploads take base64 bytes.",
      ],
      docs: `${SNAP_DOCS}/campaigns`,
    }));
}

async function patchEntity(api: SnapClient, kind: string, existing: Row, accountId: string, changes: Row) {
  const parent = kind === "adsquad" ? `campaigns/${existing.campaign_id}` : kind === "ad" ? `adsquads/${existing.ad_squad_id}` : `adaccounts/${accountId}`;
  const patch = Object.entries(changes).map(([key, value]) => ({ op: Object.hasOwn(existing, key) ? "replace" : "add", path: "/" + key, value }));
  const result = await api.request(`/${parent}/${plural(kind)}/${existing.id}`, { method: "PATCH", body: patch });
  return verifiedSnapWrite(api, kind, accountId, changes, result, existing.id);
}

/** Every referenced pixel, app, audience, media or creative must belong to the selected account. */
async function validateReferences(api: SnapClient, kind: Kind, item: Row, accountId: string): Promise<void> {
  const refs: Array<[string, unknown]> = [];
  if (kind === "segment" && item.creation_spec?.seed_segment_id) refs.push(["segment", item.creation_spec.seed_segment_id]);
  if (kind === "segment")
    for (const source of item.engagement_specs ?? []) {
      const entity = ({ AD_ACCOUNT: "adaccount", CAMPAIGN: "campaign", AD_SQUAD: "adsquad" } as Row)[source.source_type];
      if (!entity) throw new Error("Unsupported engagement source type.");
      refs.push([entity, source.source_id]);
    }
  const pixelId = kind === "campaign" ? item.shared_properties?.shared_pixel_id : item.pixel_id;
  if (pixelId && ["campaign", "adsquad", "segment"].includes(kind)) {
    const pixels = rows(await api.request(`/adaccounts/${accountId}/pixels`), "pixels", "pixel");
    if (!pixels.some((p) => p.id === pixelId)) throw new Error("Pixel is not accessible through the selected ad account.");
  }
  const appIds = [
    ...(item.event_sources?.MOBILE_APP ?? []),
    ...(item.mobile_app_properties?.mobile_app_id ? [item.mobile_app_properties.mobile_app_id] : []),
    ...(item.mobile_metadata?.mobile_snapkit_id ? [item.mobile_metadata.mobile_snapkit_id] : []),
  ];
  if (appIds.length) {
    const apps = rows(await api.request(`/adaccounts/${accountId}/mobile_apps`), "mobile_apps", "mobile_app");
    if (appIds.some((mid) => !apps.some((app) => app.id === mid))) throw new Error("Mobile app is not associated with the selected ad account.");
  }
  if (kind === "adsquad")
    for (const t of item.targeting?.segments ?? []) {
      for (const sid of Array.isArray(t.segment_id) ? t.segment_id : t.segment_id ? [t.segment_id] : []) refs.push(["segment", sid]);
      for (const sid of t.segment_ids ?? []) refs.push(["segment", sid]);
    }
  if (kind === "lead_generation_form" && item.banner_media_id) refs.push(["media", item.banner_media_id]);
  if (kind === "creative" || kind === "creative_element") {
    for (const mid of [
      item.preview_properties?.preview_media_id,
      item.preview_properties?.logo_media_id,
      item.ad_to_lens_properties?.lens_media_id,
      item.app_install_properties?.icon_media_id,
      item.deep_link_properties?.icon_media_id,
      item.button_properties?.button_overlay_media_id,
      item.chat_properties?.wallpaper_media_id,
    ])
      if (mid) refs.push(["media", mid]);
    if (item.lead_generation_form_id) refs.push(["lead_generation_form", item.lead_generation_form_id]);
    if (item.preview_creative_id) refs.push(["creative", item.preview_creative_id]);
    for (const cid of item.composite_properties?.creative_ids ?? []) refs.push(["creative", cid]);
    if (item.collection_properties?.interaction_zone_id) refs.push(["interaction_zone", item.collection_properties.interaction_zone_id]);
  }
  if (kind === "interaction_zone") for (const eid of item.creative_element_ids ?? []) refs.push(["creative_element", eid]);
  if (refs.length > 100) throw new Error("At most 100 linked entities per edit.");
  for (const [entity, value] of refs) {
    const ref = entity === "segment" ? segmentId.parse(value) : id.parse(value);
    await api.entity(entity, ref, accountId);
  }
}

function uploadPath(path: string, mediaId: string, action: string): string {
  if (!new RegExp("^/(?:[a-z]{2,16}/)?v1/media/" + mediaId + "/multipart-upload-v2\\?action=" + action + "$").test(path))
    throw new Error("Upload path must match this media ID and action on Snap.");
  return path;
}

/** Decode strict base64. atob refuses characters that Buffer would silently skip. */
function decode(base64: string): string {
  try {
    return atob(base64);
  } catch {
    throw new Error("base64 is not valid base64. Send the raw file bytes encoded as base64, without a data URL prefix.");
  }
}

export function registerSnapWrites(c: Collector, api: SnapClient): void {
  const register = registrar(c, api);

  for (const kind of kinds) {
    const paused = ["campaign", "adsquad", "ad"].includes(kind);
    register(`snapchat_create_${kind}`,
      `Create a Snapchat ${kind.replaceAll("_", " ")}. ${paused ? "Always PAUSED. " : ""}Local preview by default; confirm true writes after verifying parent/account ownership.`,
      {
        ...account,
        ...(kind === "adsquad" ? { parentId: id.describe("Campaign UUID that will own the ad squad.") } : {}),
        ...(kind === "ad" ? { parentId: id.describe("Ad squad UUID that will own the ad.") } : {}),
        spec: native,
        confirm,
      },
      async (a) => {
        const item = payload(kind, a.spec, true);
        const parentKind = kind === "adsquad" ? "campaign" : kind === "ad" ? "adsquad" : "adaccount";
        const parent = a.parentId ?? a.adAccountId;
        if (item[spec[kind].parent] && item[spec[kind].parent] !== parent) throw new Error("Parent cannot override selected account.");
        item[spec[kind].parent] = parent;
        if (paused) item.status = "PAUSED";
        const path = `/${parentKind === "adaccount" ? "adaccounts" : parentKind + "s"}/${parent}/${plural(kind)}`;
        if (!a.confirm)
          return { preview: true, method: "POST", path, payload: { [plural(kind)]: [item] }, providerValidated: false, message: PREVIEW_NOTE };
        const owner = await api.entity(parentKind, parent, a.adAccountId);
        if (kind === "adsquad") validateSnapSquad(item, owner);
        await validateReferences(api, kind, item, a.adAccountId);
        if (kind === "ad") await api.entity("creative", String(item.creative_id), a.adAccountId);
        if (kind === "creative" && item.top_snap_media_id) await api.entity("media", String(item.top_snap_media_id), a.adAccountId);
        const result = await api.request(path, { method: "POST", body: { [plural(kind)]: [item] } });
        return verifiedSnapWrite(api, kind, a.adAccountId, item, result);
      });

    if (!["campaign", "adsquad", "ad", "creative"].includes(kind)) continue;
    register(`snapchat_update_${kind}`,
      `Update Snapchat ${kind} configuration, including name${kind === "adsquad" ? ", targeting, schedule and budget" : ""}. Preview by default; ownership checked before applying.`,
      { ...account, entityId: id.describe(`UUID of the ${kind} to update.`), spec: native, confirm },
      async (a) => {
        const item = payload(kind, a.spec, false);
        if (!Object.keys(item).length) throw new Error("At least one edit is required.");
        if (!a.confirm) return { preview: true, entityId: a.entityId, changes: item, method: "PATCH", providerValidated: false, message: PREVIEW_NOTE };
        const existing = await api.entity(kind, a.entityId, a.adAccountId);
        const merged = { ...existing, ...item };
        // Snap can return zero/null for inactive budget modes. An unrelated edit
        // must not reinterpret those provider defaults as requested budgets.
        for (const field of ["daily_budget_micro", "lifetime_budget_micro", "lifetime_spend_cap_micro"])
          if (!(field in item) && (merged[field] == null || merged[field] === 0)) delete merged[field];
        if (kind === "adsquad") {
          const campaign = await api.entity("campaign", existing.campaign_id, a.adAccountId);
          if (campaign.pacing_level === "CAMPAIGN") {
            delete merged.daily_budget_micro;
            delete merged.lifetime_budget_micro;
            Object.assign(merged, item);
          }
          validateSnapSquad(merged, campaign);
        }
        validateSnapSettings(kind, merged);
        if (kind === "creative") validateSnapCreative(merged, false);
        await validateReferences(api, kind, item, a.adAccountId);
        if (item.creative_id) await api.entity("creative", String(item.creative_id), a.adAccountId);
        if (item.top_snap_media_id) await api.entity("media", String(item.top_snap_media_id), a.adAccountId);
        return patchEntity(api, kind, existing, a.adAccountId, item);
      });
  }

  // A JSON Patch of /name alone: Snap validates it like a full update, and
  // nothing else in the entity can move.
  const snapName = z.string().trim().min(1).max(375).describe("New name, up to 375 characters. This is the only thing the call changes.");
  for (const [kind, param, label] of [
    ["campaign", "campaignId", "campaign"],
    ["adsquad", "adSquadId", "ad squad"],
    ["ad", "adId", "ad"],
  ] as const)
    register(`snapchat_rename_${kind}`,
      `Rename one Snapchat ${label}. The name is the only thing that changes. Preview by default; ownership checked before applying.`,
      { ...account, [param]: id.describe(`UUID of the ${label} to rename.`), name: snapName, confirm },
      async (a) => {
        if (!a.confirm) return renamePreview(`snapchat_rename_${kind}`, a[param], a.name);
        const existing = await api.entity(kind, a[param], a.adAccountId);
        return patchEntity(api, kind, existing, a.adAccountId, { name: a.name });
      });

  // Ad accounts have no PATCH, and a PUT resets every omitted field to its
  // default: the account goes back exactly as read, with only the name changed.
  register("snapchat_rename_ad_account",
    "Rename the selected Snapchat ad account. Snap only accepts a full account update, so the account is read and written back unchanged except for its name. Preview by default.",
    { ...account, name: snapName, confirm },
    async (a) => {
      if (!a.confirm) return renamePreview("snapchat_rename_ad_account", a.adAccountId, a.name);
      const existing = await api.entity("adaccount", a.adAccountId, a.adAccountId);
      if (!z.string().uuid().safeParse(existing.organization_id).success)
        throw new Error("Snap did not return the ad account's organization. Nothing was changed.");
      const { created_at: _created, updated_at: _updated, ...current } = existing;
      const result = await api.request(`/organizations/${existing.organization_id}/adaccounts`, { method: "PUT", body: { adaccounts: [{ ...current, name: a.name }] } });
      return verifiedSnapWrite(api, "adaccount", a.adAccountId, { name: a.name }, result, a.adAccountId);
    });

  register("snapchat_update_status",
    "Pause or activate a campaign, ad squad or ad. Preview by default; activating production entities can spend budget.",
    {
      ...account,
      kind: z.enum(["campaign", "adsquad", "ad"]).describe("Entity type to update."),
      entityId: id.describe("UUID of the campaign, ad squad or ad."),
      status: z.enum(["PAUSED", "ACTIVE"]).describe("Explicit requested delivery status. ACTIVE can spend budget."),
      confirm,
    },
    async (a) => {
      if (!a.confirm)
        return {
          preview: true, entityId: a.entityId, changes: { status: a.status }, method: "PATCH", providerValidated: false,
          activationMaySpend: a.status === "ACTIVE", message: PREVIEW_NOTE,
        };
      const existing = await api.entity(a.kind, a.entityId, a.adAccountId);
      return patchEntity(api, a.kind, existing, a.adAccountId, { status: a.status });
    });

  register("snapchat_upload_media",
    "Upload base64 image/video bytes to a previously created media object. Maximum 5 MB per image or 10 MiB per direct video, decoded. Use the multipart upload tools for larger videos. No external URL fetching. Preview does not send bytes; confirm true uploads after ownership verification.",
    {
      ...account,
      mediaId: id.describe("Media UUID created with snapchat_create_media and awaiting upload."),
      fileName: z.string().max(200).regex(/^[a-zA-Z0-9_.-]+$/).describe("Filename including extension."),
      mimeType: z.enum(["image/png", "image/jpeg", "video/mp4", "video/quicktime"]).describe("MIME type of the uploaded bytes."),
      base64: z.string().max(14_000_000).describe("Base64 file content, without a data URL prefix."),
      confirm,
    },
    async (a) => {
      const binary = decode(a.base64);
      if (binary.length > (a.mimeType.startsWith("image/") ? 5_000_000 : 10 * 1024 * 1024) || binary.length === 0)
        throw new Error("Media must be nonempty, at most 5 MB for an image or 10 MiB for a direct video upload.");
      if (!a.confirm)
        return { preview: true, mediaId: a.mediaId, fileName: a.fileName, mimeType: a.mimeType, bytes: binary.length, providerValidated: false, message: PREVIEW_NOTE };
      await api.entity("media", a.mediaId, a.adAccountId);
      const form = new FormData();
      form.append("file", new Blob([Buffer.from(binary, "latin1")], { type: a.mimeType }), a.fileName);
      const result = await api.request(`/media/${a.mediaId}/upload`, { method: "POST", body: form });
      return { ...result, mediaId: a.mediaId, next: "Call snapchat_get_media_status until ready:true before creating a creative." };
    });

  register("snapchat_update_segment",
    "Rename or edit retention/description of an audience segment. Unchanged fields are preserved. Local preview unless confirm true.",
    {
      ...account,
      segmentId,
      name: z.string().min(1).max(375).optional().describe("Audience display name."),
      description: z.string().max(2000).optional().describe("Audience description; empty string clears it."),
      retentionInDays: z.number().int().min(1).max(9999).optional().describe("Retention days, subject to audience-type limits."),
      confirm,
    },
    async (a) => {
      const changes = {
        ...(a.name ? { name: a.name } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.retentionInDays ? { retention_in_days: a.retentionInDays } : {}),
      };
      if (!Object.keys(changes).length) throw new Error("At least one edit is required.");
      if (!a.confirm) return { preview: true, segmentId: a.segmentId, changes, providerValidated: false, message: PREVIEW_NOTE };
      const existing = await api.entity("segment", a.segmentId, a.adAccountId);
      return api.request(`/adaccounts/${a.adAccountId}/segments`, {
        method: "PUT",
        body: {
          segments: [{
            id: existing.id,
            name: existing.name,
            retention_in_days: existing.retention_in_days,
            ...(existing.organization_id ? { organization_id: existing.organization_id } : {}),
            ...(existing.description !== undefined ? { description: existing.description } : {}),
            ...changes,
          }],
        },
      });
    });

  register("snapchat_update_audience_users",
    "Add or remove customer-list members. Accepts only normalized SHA-256 hashes: EMAIL_SHA256, PHONE_SHA256, MOBILE_AD_ID_SHA256. Normalize emails by trimming/lowercasing; phones to country-code digits; mobile IDs lowercase retaining hyphens. Never invent customer data. Preview returns counts, not hashes. Caller batches up to 10,000 per request; confirm true applies.",
    {
      ...account,
      segmentId,
      action: z.enum(["add", "remove"]).describe("Add or remove these hashed members."),
      schema: z.enum(["EMAIL_SHA256", "PHONE_SHA256", "MOBILE_AD_ID_SHA256"]).describe("Identifier type hashed in every row."),
      hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(10000).describe("Normalized identifiers hashed with SHA-256, lowercase hexadecimal. Never raw personal data."),
      confirm,
    },
    async (a) => {
      if (!a.confirm)
        return { preview: true, segmentId: a.segmentId, action: a.action, schema: a.schema, count: a.hashes.length, providerValidated: false, message: PREVIEW_NOTE };
      const segment = await api.entity("segment", a.segmentId, a.adAccountId);
      if (segment.source_type !== "FIRST_PARTY") throw new Error("Members can only be uploaded to a FIRST_PARTY customer list.");
      const result = await api.request(`/segments/${a.segmentId}/users`, {
        method: a.action === "add" ? "POST" : "DELETE",
        body: { users: [{ schema: [a.schema], data: a.hashes.map((h: string) => [h]) }] },
      });
      return { ...result, segmentId: a.segmentId, action: a.action, count: a.hashes.length };
    });

  register("snapchat_create_lookalike",
    "Create a lookalike audience from an owned customer-list seed. Provider eligibility and sufficient seed size still apply; creation does not guarantee targetable_status READY. Preview unless confirm true.",
    {
      ...account,
      name: z.string().min(1).max(375).describe("Audience display name."),
      seedSegmentId: segmentId,
      countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(20).describe("Uppercase ISO 3166-1 country codes for the lookalike."),
      type: z.enum(["BALANCE", "SIMILARITY", "REACH"]).default("BALANCE").describe("Lookalike similarity versus reach preference."),
      retentionInDays: z.number().int().min(1).max(180).default(180).describe("Lookalike retention, at most 180 days."),
      confirm,
    },
    async (a) => {
      const item = {
        ad_account_id: a.adAccountId,
        name: a.name,
        source_type: "LOOKALIKE",
        retention_in_days: a.retentionInDays,
        creation_spec: { seed_segment_id: a.seedSegmentId, countries: a.countries, type: a.type },
      };
      if (!a.confirm) return { preview: true, payload: { segments: [item] }, providerValidated: false, message: PREVIEW_NOTE };
      const seed = await api.entity("segment", a.seedSegmentId, a.adAccountId);
      if (seed.source_type !== "FIRST_PARTY") throw new Error("A lookalike seed must be a FIRST_PARTY customer list.");
      return api.request(`/adaccounts/${a.adAccountId}/segments`, { method: "POST", body: { segments: [item] } });
    });

  register("snapchat_init_media_upload",
    "Initialize a chunked video upload, up to 256 MiB across at most 32 parts of 8 MiB. Returns upload_id, add_path and finalize_path to use for subsequent calls. Preview unless confirm true.",
    {
      ...account,
      mediaId: id.describe("VIDEO media UUID created with snapchat_create_media."),
      fileName: z.string().max(200).regex(/^[a-zA-Z0-9_.-]+$/).describe("Video filename including extension, without directories."),
      fileSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES).describe("Total decoded video size in bytes, at most 256 MiB."),
      numberOfParts: z.number().int().min(1).max(32).describe("Number of nonempty parts, each at most 8 MiB."),
      confirm,
    },
    async (a) => {
      if (a.fileSize > a.numberOfParts * CHUNK_BYTES || a.numberOfParts > a.fileSize) throw new Error("Choose enough nonempty parts, each at most 8 MiB.");
      if (!a.confirm)
        return { preview: true, mediaId: a.mediaId, fileSize: a.fileSize, numberOfParts: a.numberOfParts, providerValidated: false, message: PREVIEW_NOTE };
      const media = await api.entity("media", a.mediaId, a.adAccountId);
      if (media.type !== "VIDEO") throw new Error("Chunked upload requires VIDEO media.");
      const form = new FormData();
      form.append("file_name", a.fileName);
      form.append("file_size", String(a.fileSize));
      form.append("number_of_parts", String(a.numberOfParts));
      return { ...await api.request(`/media/${a.mediaId}/multipart-upload-v2?action=INIT`, { method: "POST", body: form }), mediaId: a.mediaId };
    });

  register("snapchat_upload_media_part",
    "Upload one video part, at most 8 MiB decoded. Use the exact add_path and upload_id returned by snapchat_init_media_upload. Preview never sends bytes.",
    {
      ...account,
      mediaId: id.describe("VIDEO media UUID being uploaded."),
      uploadId: id.describe("upload_id returned by snapchat_init_media_upload."),
      addPath: z.string().max(300).describe("Exact add_path returned by upload initialization."),
      partNumber: z.number().int().min(1).max(32).describe("One-based part number from 1 through numberOfParts."),
      base64: z.string().max(11_200_000).describe("Base64-encoded bytes of this part, without a data URL prefix."),
      confirm,
    },
    async (a) => {
      const path = uploadPath(a.addPath, a.mediaId, "ADD");
      const binary = decode(a.base64);
      if (!binary.length || binary.length > CHUNK_BYTES) throw new Error("Each part must be 1 byte to 8 MiB.");
      if (!a.confirm) return { preview: true, mediaId: a.mediaId, partNumber: a.partNumber, bytes: binary.length, providerValidated: false, message: PREVIEW_NOTE };
      await api.entity("media", a.mediaId, a.adAccountId);
      const form = new FormData();
      form.append("upload_id", a.uploadId);
      form.append("part_number", String(a.partNumber));
      form.append("file", new Blob([Buffer.from(binary, "latin1")]), "part.bin");
      return { ...await api.request(path, { method: "POST", body: form, originPath: true }), mediaId: a.mediaId, partNumber: a.partNumber };
    });

  register("snapchat_finalize_media_upload",
    "Finalize a video upload after all parts succeeded. Use the exact finalize_path and upload_id returned by snapchat_init_media_upload. Preview unless confirm true.",
    {
      ...account,
      mediaId: id.describe("VIDEO media UUID being uploaded."),
      uploadId: id.describe("upload_id returned by snapchat_init_media_upload."),
      finalizePath: z.string().max(300).describe("Exact finalize_path returned by upload initialization."),
      confirm,
    },
    async (a) => {
      const path = uploadPath(a.finalizePath, a.mediaId, "FINALIZE");
      if (!a.confirm) return { preview: true, mediaId: a.mediaId, uploadId: a.uploadId, providerValidated: false, message: PREVIEW_NOTE };
      await api.entity("media", a.mediaId, a.adAccountId);
      const form = new FormData();
      form.append("upload_id", a.uploadId);
      return {
        ...await api.request(path, { method: "POST", body: form, originPath: true }),
        mediaId: a.mediaId,
        next: "Call snapchat_get_media_status until ready:true before creating a creative.",
      };
    });
}

