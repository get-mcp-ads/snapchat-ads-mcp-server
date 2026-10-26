/**
 * snapchat-ads-mcp-server: an open-source MCP server for the Snapchat Marketing API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret = z.string().min(1).max(8192).optional();

const schema = z.object({
  accessToken: secret,
  refreshToken: secret,
  clientId: z.string().min(1).max(512).optional(),
  clientSecret: secret,
  allowedAccountIds: z.array(z.string()),
  enableWrites: z.boolean().prefault(false),
});

export type SnapConfig = {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Lowercase ad account UUIDs. Every request is checked against this list. */
  allowedAccountIds: string[];
  enableWrites: boolean;
};

/**
 * Validate a configuration object. Error messages name the variables to set
 * and never repeat a value, so a misplaced token cannot reach a log.
 */
export function validateConfig(value: unknown): SnapConfig {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Invalid Snapchat Ads configuration. Check SNAPCHAT_ADS_ACCESS_TOKEN, SNAPCHAT_ADS_REFRESH_TOKEN, " +
        "SNAPCHAT_ADS_CLIENT_ID, SNAPCHAT_ADS_CLIENT_SECRET, SNAPCHAT_ADS_ACCOUNT_IDS and SNAPCHAT_ADS_ENABLE_WRITES.",
    );
  }
  const config = parsed.data;
  const problems: string[] = [];
  const refresh = [config.refreshToken, config.clientId, config.clientSecret].filter(Boolean).length;
  if (refresh !== 0 && refresh !== 3) {
    problems.push("SNAPCHAT_ADS_REFRESH_TOKEN, SNAPCHAT_ADS_CLIENT_ID and SNAPCHAT_ADS_CLIENT_SECRET work together: set all three or none.");
  } else if (!config.accessToken && refresh === 0) {
    problems.push("Set SNAPCHAT_ADS_ACCESS_TOKEN, or SNAPCHAT_ADS_REFRESH_TOKEN with SNAPCHAT_ADS_CLIENT_ID and SNAPCHAT_ADS_CLIENT_SECRET.");
  }
  const accounts = [...new Set(config.allowedAccountIds.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  if (!accounts.length || accounts.length > 200 || accounts.some((id) => !UUID.test(id))) {
    problems.push(
      "Set SNAPCHAT_ADS_ACCOUNT_IDS to 1-200 comma-separated Snapchat ad account UUIDs. Organization IDs are not ad account IDs.",
    );
  }
  if (problems.length) throw new Error(`Invalid Snapchat Ads configuration. ${problems.join(" ")}`);
  return { ...config, allowedAccountIds: accounts };
}

/** Read the configuration from the environment once, at startup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SnapConfig {
  // Unset or empty means false. Any value other than the exact words is refused,
  // so a value such as "1" or "yes" is never read as a decision either way.
  const flag = env.SNAPCHAT_ADS_ENABLE_WRITES || "false";
  if (flag !== "true" && flag !== "false") {
    throw new Error("SNAPCHAT_ADS_ENABLE_WRITES must be true or false. Only the exact value true exposes write tools.");
  }
  const value = (name: string) => {
    const raw = env[name]?.trim();
    return raw ? raw : undefined;
  };
  return validateConfig({
    accessToken: value("SNAPCHAT_ADS_ACCESS_TOKEN"),
    refreshToken: value("SNAPCHAT_ADS_REFRESH_TOKEN"),
    clientId: value("SNAPCHAT_ADS_CLIENT_ID"),
    clientSecret: value("SNAPCHAT_ADS_CLIENT_SECRET"),
    allowedAccountIds: (env.SNAPCHAT_ADS_ACCOUNT_IDS ?? "").split(","),
    enableWrites: flag === "true",
  });
}
