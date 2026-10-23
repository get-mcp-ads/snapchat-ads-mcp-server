/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";
import { SnapClient, rows, plural, type Row } from "./client.js";

/** Provider-added fields are harmless; every explicitly approved value must match. */
export function receiptDifferences(expected: unknown, actual: unknown, path = ""): string[] {
  if (expected === null || typeof expected !== "object") {
    if (expected === actual || (typeof expected === "number" && typeof actual === "string" && actual.trim() !== "" && expected === Number(actual))) return [];
    if (/(?:start|end)_time$/.test(path) && typeof expected === "string" && typeof actual === "string" &&
      Number.isFinite(Date.parse(expected)) && Date.parse(expected) === Date.parse(actual)) return [];
    return [path || "/"];
  }
  if (!actual || typeof actual !== "object" || Array.isArray(expected) !== Array.isArray(actual)) return [path || "/"];
  if (Array.isArray(expected) && expected.length !== (actual as unknown[]).length) return [path || "/"];
  return Object.entries(expected).flatMap(([key, value]) => receiptDifferences(value, (actual as Row)[key], path + "/" + key));
}

// Native values from Snap's creative type to CTA mapping, not labels from other platforms.
export const SNAP_CREATIVE_CTAS: Record<string, string[]> = {
  WEB_VIEW: "APPLY_NOW MORE ORDER_NOW PLAY READ SHOP_NOW SHOW SIGN_UP VIEW WATCH DONATE DOWNLOAD RESPOND BUY_TICKETS SHOWTIMES BOOK_NOW GET_NOW LISTEN TRY VOTE VIEW_MENU PRE_REGISTER PLAY_GAME".split(" "),
  APP_INSTALL: "BOOK_NOW DONATE DOWNLOAD GET_NOW INSTALL_NOW ORDER_NOW PLAY SHOP_NOW SIGN_UP TRY USE_APP WATCH VOTE DIRECTIONS PLAY_GAME".split(" "),
  DEEP_LINK: "DONATE PLAY SHOP_NOW SIGN_UP USE_APP MORE OPEN_APP TRY WATCH VIEW_PROFILE VOTE DIRECTIONS PRE_REGISTER PLAY_GAME DOWNLOAD".split(" "),
  LEAD_GENERATION: "APPLY_NOW MORE BOOK_NOW GET_NOW SIGN_UP TEST_DRIVE REQUEST_APPOINTMENT REQUEST_QUOTE FREE_TRIAL CLAIM_SAMPLE GET_COUPON".split(" "),
};

/** Validate explicit settings without silently altering the approved payload. */
export function validateSnapSettings(kind: string, item: Row): void {
  if (kind === "interaction_zone" && item.headline != null && !SNAP_CREATIVE_CTAS.WEB_VIEW.includes(item.headline))
    throw new Error("Interaction zone headline is a native Web View CTA code, such as MORE or SHOP_NOW, not free text.");
  for (const field of ["start_time", "end_time"]) {
    if (item[field] != null && !z.string().datetime({ offset: true }).safeParse(item[field]).success)
      throw new Error(`${field} must be an ISO timestamp with a timezone.`);
  }
  if (item.start_time && item.end_time && Date.parse(item.end_time) <= Date.parse(item.start_time))
    throw new Error("end_time must be after start_time.");
  if (kind === "adsquad" && item.daily_budget_micro != null && item.lifetime_budget_micro != null)
    throw new Error("Choose a daily or lifetime ad squad budget, not both.");
  for (const field of ["daily_budget_micro", "lifetime_budget_micro", "lifetime_spend_cap_micro"])
    if (item[field] != null && (!Number.isSafeInteger(item[field]) || item[field] <= 0))
      throw new Error(`${field} must be a positive integer in micro currency.`);
  if (kind === "campaign" && item.pacing_level === "CAMPAIGN") {
    if (!item.daily_budget_micro && !item.lifetime_spend_cap_micro)
      throw new Error("Smart Budgets requires an explicit campaign budget.");
    if (!item.shared_properties?.shared_optimization_goal || !item.shared_properties?.shared_ad_squad_bid_strategy)
      throw new Error("Smart Budgets requires shared optimization and bid strategy.");
  }
}

/** An ad squad either owns its budget or follows the campaign's Smart Budgets settings exactly. */
export function validateSnapSquad(item: Row, campaign: Row): void {
  if (campaign.pacing_level !== "CAMPAIGN") {
    if (!item.daily_budget_micro && !item.lifetime_budget_micro)
      throw new Error("An ad squad outside Smart Budgets needs an explicit budget.");
    return;
  }
  if (item.daily_budget_micro != null || item.lifetime_budget_micro != null)
    throw new Error("Smart Budgets controls the campaign budget; omit independent ad squad budgets.");
  const shared = campaign.shared_properties ?? {};
  for (const [native, parent] of Object.entries({
    optimization_goal: "shared_optimization_goal",
    bid_strategy: "shared_ad_squad_bid_strategy",
    conversion_window: "shared_conversion_window",
    pixel_id: "shared_pixel_id",
  })) {
    if (shared[parent] != null && receiptDifferences(shared[parent], item[native]).length)
      throw new Error(`Ad squad ${native} must match the campaign Smart Budgets setting.`);
  }
}

export function validateSnapCreative(item: Row, create: boolean): void {
  if (create && item.type !== "PREVIEW" && !z.string().uuid().safeParse(item.profile_properties?.profile_id).success)
    throw new Error("A creative requires an authorized public profile: profile_properties.profile_id. Read an existing account creative or select a profile shared with this ad account.");
  const allowed = SNAP_CREATIVE_CTAS[item.type];
  if (item.call_to_action && allowed && !allowed.includes(item.call_to_action))
    throw new Error(`Invalid native ${item.type} call_to_action. Use one of: ${allowed.join(", ")}.`);
}

/**
 * A successful write is reported as applied even when the readback that
 * follows times out or differs: the receipt is kept so nobody resends it.
 */
export async function verifiedSnapWrite(api: SnapClient, kind: string, account: string, expected: Row, result: Row, entityId?: string) {
  const id = entityId ?? rows(result, plural(kind), kind)[0]?.id;
  try {
    if (typeof id !== "string") throw new Error("Native acknowledgement has no entity ID.");
    const actual = await api.entity(kind, id, account);
    const differences = receiptDifferences(expected, actual);
    return { ...result, applied: true, result, verification: { confirmed: differences.length === 0, method: "exact_account_scoped_readback", entityId: id, differences } };
  } catch {
    return {
      ...result, applied: true, result,
      verification: { confirmed: false, entityId: id, reason: "Snap acknowledged the write but the readback was unavailable. Keep this receipt and read the exact ID before any retry." },
    };
  }
}
