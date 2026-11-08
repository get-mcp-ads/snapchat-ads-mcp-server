#!/usr/bin/env node
/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * stdout carries the MCP protocol. Every message for people goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { nodeRuntimeWarning } from "./runtime-check.js";
import { createServer } from "./server.js";

const warning = nodeRuntimeWarning();
if (warning) console.error(`[snapchat-ads-mcp] ${warning}`);

try {
  await createServer(loadConfig()).connect(new StdioServerTransport());
} catch (error) {
  console.error(`[snapchat-ads-mcp] ${error instanceof Error ? error.message : "Snapchat Ads server failed to start."}`);
  process.exitCode = 1;
}
