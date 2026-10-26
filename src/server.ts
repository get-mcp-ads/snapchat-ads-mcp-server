/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateConfig, type SnapConfig } from "./config.js";
import { registerSnapchat } from "./platforms/snapchat/index.js";
import { installToolQuality } from "./tool-quality.js";

export const PACKAGE_VERSION = "1.0.1";

export function createServer(input: SnapConfig): McpServer {
  const config = validateConfig(input);
  const server = new McpServer(
    {
      name: "snapchat-ads-mcp",
      version: PACKAGE_VERSION,
      title: "Snapchat Ads",
      websiteUrl: "https://www.getmcpads.com/tools/snapchat-ads",
      icons: [{ src: "https://mcp.getmcpads.com/icon.svg", mimeType: "image/svg+xml" }],
    },
    { capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } } },
  );
  installToolQuality(server);
  registerSnapchat(server, config);
  return server;
}
