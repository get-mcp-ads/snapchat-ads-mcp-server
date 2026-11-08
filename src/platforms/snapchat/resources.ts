/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SNAP_DIMENSIONS, SNAP_METRICS } from "./catalog.js";
import { SNAP_DOCS } from "./hosts.js";

export const SNAP_GUIDE = [
  "Only the ad accounts listed in SNAPCHAT_ADS_ACCOUNT_IDS are reachable; every request is checked first.",
  "Ad squads are ad groups. snapchat_get_targeting reads configuration; snapchat_get_insights reads delivery.",
  "spend, monetary conversion values and every field ending in _micro are micro currency: 1,000,000 equals one unit of the account currency.",
  "List tools return next_cursor; pass it back as cursor for the next page. Insights flag partial:true when Snap returned another page.",
  "Align DAY intervals to midnight in the ad account timezone, which snapchat_health_check returns.",
  "Read snapchat_get_write_schema before editing. Nested object edits replace the whole object.",
  "Write tools exist only when SNAPCHAT_ADS_ENABLE_WRITES=true. Every write previews until confirm:true.",
  "Campaigns, ad squads and ads are created PAUSED. Activation through snapchat_update_status can spend budget.",
  "A write whose outcome is uncertain is never retried automatically. Read the entity before trying again.",
  "Test accounts cannot serve ads; zeros are not live performance evidence.",
  "Uploads take base64 bytes: 5 MB per image and 10 MiB per direct video; multipart video uploads reach 256 MiB in up to 32 parts of 8 MiB.",
  "Follow every upload with snapchat_get_media_status until ready:true before creating a creative.",
  "Call snapchat_get_setup_guide for objective and audience prerequisites. API support does not establish account eligibility.",
  "Snap documents about 20 requests per second per app and 10 per second per access token. HTTP 429 means wait before retrying.",
  `Snapchat Marketing API reference: ${SNAP_DOCS}/introduction`,
].join("\n");

export function registerSnapResources(server: Pick<McpServer, "registerResource">): void {
  server.registerResource(
    "snapchat-guide",
    "snapchat://guide",
    { title: "Snapchat Ads guide", description: "Units, pagination, write safety, upload limits and rate limits for this server.", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: SNAP_GUIDE }] }),
  );
  server.registerResource(
    "snapchat-reporting-fields",
    "snapchat://reporting-fields",
    {
      title: "Snapchat reporting fields",
      description: "Curated stats fields and breakdowns for snapchat_get_insights. Not an exhaustive list of the Snap API.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          note: "Curated reporting fields, not an exhaustive claim about the provider API. Pass metric keys in fields.",
          metrics: SNAP_METRICS,
          dimensions: SNAP_DIMENSIONS,
          documentation: `${SNAP_DOCS}/introduction`,
        }),
      }],
    }),
  );
}
