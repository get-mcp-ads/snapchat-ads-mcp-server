import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateConfig } from "../src/config.ts";

const ACCOUNT = "e2388280-66d3-4e8e-a720-2f7a7d261a24";

test("invalid or empty configuration cannot enable unscoped access or reveal its token", () => {
  for (const value of [
    {},
    { accessToken: "private-token", allowedAccountIds: [] },
    { accessToken: "private-token", allowedAccountIds: ["../other"] },
    { accessToken: "private-token", allowedAccountIds: [ACCOUNT], refreshToken: "private-refresh" },
    { allowedAccountIds: [ACCOUNT] },
  ]) assert.throws(() => validateConfig(value), (e) => /SNAPCHAT_ADS_/.test(e.message) && !e.message.includes("private-token") && !e.message.includes("private-refresh"));
  const config = validateConfig({ accessToken: "fixture", allowedAccountIds: [ACCOUNT] });
  assert.equal(config.enableWrites, false);
});

test("only the exact value true enables writes", () => {
  const base = { SNAPCHAT_ADS_ACCESS_TOKEN: "t", SNAPCHAT_ADS_ACCOUNT_IDS: ACCOUNT };
  assert.equal(loadConfig(base).enableWrites, false);
  assert.equal(loadConfig({ ...base, SNAPCHAT_ADS_ENABLE_WRITES: "false" }).enableWrites, false);
  assert.equal(loadConfig({ ...base, SNAPCHAT_ADS_ENABLE_WRITES: "true" }).enableWrites, true);
  for (const flag of ["1", "yes", "True", " true"]) assert.throws(() => loadConfig({ ...base, SNAPCHAT_ADS_ENABLE_WRITES: flag }), /SNAPCHAT_ADS_ENABLE_WRITES/);
});
