/**
 * The README documents every tool and resource by name. A tool renamed in the
 * code and not in the README is a documentation bug, and this test fails on it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let cached;
async function introspect() {
  if (cached) return cached;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => typeof v === "string" && !k.startsWith("SNAPCHAT_ADS_")));
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/cli.js"],
    env: { ...env, SNAPCHAT_ADS_ACCESS_TOKEN: "token-for-listing", SNAPCHAT_ADS_ACCOUNT_IDS: "e2388280-66d3-4e8e-a720-2f7a7d261a24", SNAPCHAT_ADS_ENABLE_WRITES: "true" },
    stderr: "pipe",
  });
  const client = new Client({ name: "readme-check", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  const definitions = (await client.listTools()).tools;
  const resources = (await client.listResources()).resources.map((r) => r.uri);
  await client.close();
  cached = { tools: definitions.map((t) => t.name), resources, definitions };
  return cached;
}

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("README documents every tool the server exposes, and only those", async () => {
  const { tools } = await introspect();
  const cited = new Set([...README.matchAll(/`(snapchat_[a-z_]+)`/g)].map((m) => m[1]));
  const undocumented = tools.filter((t) => !cited.has(t));
  assert.deepEqual(undocumented, [], `Tools missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter((c) => !tools.includes(c));
  assert.deepEqual(invented, [], `README cites tools that do not exist: ${invented.join(", ")}`);
});

test("README documents every resource the server exposes, and only those", async () => {
  const { resources } = await introspect();
  const cited = new Set([...README.matchAll(/`(snapchat:\/\/[a-z0-9-]+)`/g)].map((m) => m[1]));
  assert.deepEqual(resources.filter((r) => !cited.has(r)), [], "Resources missing from README");
  assert.deepEqual([...cited].filter((c) => !resources.includes(c)), [], "README cites resources that do not exist");
});

test("README, package and registry counts match reality", async () => {
  const { tools, resources, definitions } = await introspect();
  const writes = definitions.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
  const reads = tools.filter((t) => !writes.includes(t));

  assert.equal(reads.length, 21, "read tool count changed, update the README");
  assert.equal(writes.length, 25, "write tool count changed, update the README");
  assert.equal(resources.length, 2, "resource count changed, update the README");

  assert.match(README, new RegExp(`\\*\\*${reads.length} read tools\\*\\* · \\*\\*${writes.length} write tools\\*\\*, disabled by default\\.`));
  assert.match(README, new RegExp(`<b>${reads.length} read tools</b>`));
  assert.match(README, new RegExp(`<b>${writes.length} write tools</b>`));
  for (const name of ["package.json", "server.json"]) {
    const description = JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8")).description;
    assert.match(description, new RegExp(`${reads.length} read tools, ${writes.length} opt-in`), name);
  }
});

test("published prose uses no em dashes", () => {
  const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "RELEASING.md", "SOURCE_SYNC.md", "NOTICE", ".env.example", "server.json", "package.json"];
  const walk = (dir, acc = []) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, acc);
      else if (/\.(ts|mjs)$/.test(entry.name)) acc.push(`${dir}/${entry.name}`);
    }
    return acc;
  };
  const offenders = [];
  for (const file of [...files, ...walk("src"), ...walk("scripts")]) {
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").forEach((line, i) => {
      if (line.includes("—")) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Em dashes are not used in this project. Rewrite the sentence instead of swapping the character. Found at: ${offenders.join(", ")}`);
});
