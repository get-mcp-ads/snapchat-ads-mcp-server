/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapConfig } from "../../config.js";
import { SnapClient } from "./client.js";
import { registerSnapResources } from "./resources.js";
import { registerSnapReads, registerSnapWrites, type Collector } from "./tools.js";

/** Reads always; writes only when SNAPCHAT_ADS_ENABLE_WRITES is exactly true. */
export function registerSnapchat(server: McpServer, config: SnapConfig): void {
  const api = new SnapClient(config);
  registerSnapReads(server as unknown as Collector, api);
  if (config.enableWrites) registerSnapWrites(server as unknown as Collector, api);
  registerSnapResources(server);
}
