#!/usr/bin/env node
// Reports which settings are present, never their values, and whether this
// Node.js release carries the October 2026 security fixes.
const present = (name) => typeof process.env[name] === "string" && process.env[name].length > 0;

const access = present("SNAPCHAT_ADS_ACCESS_TOKEN");
const refreshTrio = ["SNAPCHAT_ADS_REFRESH_TOKEN", "SNAPCHAT_ADS_CLIENT_ID", "SNAPCHAT_ADS_CLIENT_SECRET"];
const refresh = refreshTrio.every(present);
const partialRefresh = !refresh && refreshTrio.some(present);
const accounts = (process.env.SNAPCHAT_ADS_ACCOUNT_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const writes = process.env.SNAPCHAT_ADS_ENABLE_WRITES || "false";

let runtimeWarning;
try {
  const { nodeRuntimeWarning } = await import("../dist/index.js");
  runtimeWarning = nodeRuntimeWarning() ?? null;
} catch {
  runtimeWarning = "Run npm run build first to check the Node.js release.";
}
if (runtimeWarning) console.error(`[snapchat-ads-mcp] ${runtimeWarning}`);

const problems = [];
if (!access && !refresh) problems.push("Set SNAPCHAT_ADS_ACCESS_TOKEN, or SNAPCHAT_ADS_REFRESH_TOKEN with SNAPCHAT_ADS_CLIENT_ID and SNAPCHAT_ADS_CLIENT_SECRET.");
if (partialRefresh) problems.push("SNAPCHAT_ADS_REFRESH_TOKEN, SNAPCHAT_ADS_CLIENT_ID and SNAPCHAT_ADS_CLIENT_SECRET work together: set all three or none.");
if (!accounts.length) problems.push("Set SNAPCHAT_ADS_ACCOUNT_IDS to the ad account UUIDs this server may use.");
if (writes !== "true" && writes !== "false") problems.push("SNAPCHAT_ADS_ENABLE_WRITES must be true or false.");

const result = {
  package: "@getmcpads/snapchat-ads-mcp-server",
  node: process.versions.node,
  runtimeWarning,
  ok: problems.length === 0,
  auth: { accessTokenMode: access, refreshMode: refresh },
  accounts: accounts.length,
  writesEnabled: writes === "true",
  problems,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
