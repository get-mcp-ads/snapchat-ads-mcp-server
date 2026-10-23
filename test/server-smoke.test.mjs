/**
 * Start the built CLI the way an MCP client does. stdout must carry only the
 * protocol; configuration problems go to stderr without repeating a secret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ACCOUNT = "e2388280-66d3-4e8e-a720-2f7a7d261a24";
const clean = (extra) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => typeof v === "string" && !k.startsWith("SNAPCHAT_ADS_")));
  return { ...env, ...extra };
};

test("read-only by default over stdio", async () => {
  const transport = new StdioClientTransport({ command: "node", args: ["dist/cli.js"], env: clean({ SNAPCHAT_ADS_ACCESS_TOKEN: "smoke-token", SNAPCHAT_ADS_ACCOUNT_IDS: ACCOUNT }), stderr: "pipe" });
  const client = new Client({ name: "smoke", version: "1" });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 21);
    assert.ok(tools.every((t) => t.annotations.readOnlyHint));
    assert.equal((await client.listResources()).resources.length, 2);
  } finally {
    await client.close();
  }
});

test("a bad configuration exits with an actionable message on stderr", () => {
  const result = spawnSync("node", ["dist/cli.js"], { env: clean({ SNAPCHAT_ADS_ACCESS_TOKEN: "private-token", SNAPCHAT_ADS_ENABLE_WRITES: "1", SNAPCHAT_ADS_ACCOUNT_IDS: ACCOUNT }), encoding: "utf8", input: "" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /SNAPCHAT_ADS_ENABLE_WRITES must be true or false/);
  assert.ok(!result.stderr.includes("private-token"));
  const missing = spawnSync("node", ["dist/cli.js"], { env: clean({ SNAPCHAT_ADS_ACCESS_TOKEN: "private-token" }), encoding: "utf8", input: "" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SNAPCHAT_ADS_ACCOUNT_IDS/);
});
