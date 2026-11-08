import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createServer } from "../dist/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const fixture = { accessToken: "metadata-fixture", allowedAccountIds: ["e2388280-66d3-4e8e-a720-2f7a7d261a24"] };

async function connect(enableWrites, callback) {
  const server = createServer({ ...fixture, enableWrites });
  const client = new Client({ name: "quality-contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try { await callback(client, server); } finally { await client.close(); await server.close(); }
}

test("metadata is complete over MCP; write tools require explicit opt-in", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Metadata must not access a provider"); };
  try {
    for (const enabled of [false, true]) await connect(enabled, async (client) => {
      const tools = (await client.listTools()).tools;
      assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, "duplicate tools");
      assert.equal(tools.length, enabled ? 46 : 21);
      for (const tool of tools) {
        assert.ok(tool.name.startsWith("snapchat_"), tool.name);
        assert.ok(tool.description.length > 20, tool.name);
        assert.ok(tool.outputSchema?.required.includes("result"), tool.name);
        assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", tool.name);
        if (!enabled) assert.equal(tool.annotations.readOnlyHint, true, tool.name);
        const write = !tool.annotations.readOnlyHint;
        assert.equal(write, Boolean(tool.inputSchema.properties?.confirm), `${tool.name}: confirm if and only if it writes`);
        if (write) {
          assert.equal(tool.annotations.idempotentHint, false, tool.name);
          assert.equal(tool.inputSchema.properties.confirm.default, false, tool.name);
        }
        for (const [key, schema] of Object.entries(tool.inputSchema.properties || {})) assert.ok(schema.description, `${tool.name}.${key}`);
      }
      const resources = (await client.listResources()).resources.map((r) => r.uri).sort();
      assert.deepEqual(resources, ["snapchat://guide", "snapchat://reporting-fields"]);
      assert.equal(client.getServerVersion().websiteUrl, pkg.homepage);
      assert.equal(client.getServerVersion().version, pkg.version);
    });
  } finally { globalThis.fetch = original; }
});

test("structured output preserves text, JSON arrays and errors through the SDK", async () => {
  await connect(false, async (client, server) => {
    server.tool("quality_fixture", "Fixture that checks the actual SDK response contract.", { mode: z.enum(["json", "text", "error"]).describe("Fixture response type.") },
      async ({ mode }) => ({ ...(mode === "error" ? { isError: true } : {}), content: [{ type: "text", text: mode === "json" ? '[{"spend":0,"currency":"EUR"}]' : mode }] }));
    for (const mode of ["json", "text", "error"]) {
      const out = await client.callTool({ name: "quality_fixture", arguments: { mode } });
      if (mode === "error") { assert.equal(out.isError, true); assert.equal(out.structuredContent, undefined); }
      else { assert.equal(out.isError, undefined); assert.deepEqual(out.structuredContent.result, mode === "json" ? [{ spend: 0, currency: "EUR" }] : "text"); }
    }
  });
});

test("a tool call over MCP enforces the allowlist and rejects unknown arguments", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected"); };
  try {
    await connect(false, async (client) => {
      const out = await client.callTool({ name: "snapchat_health_check", arguments: { adAccountId: "7a544b38-3037-42ec-8514-464610058e8c" } });
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /SNAPCHAT_ADS_ACCOUNT_IDS/);
      const unknown = await client.callTool({ name: "snapchat_get_campaigns", arguments: { adAccountId: fixture.allowedAccountIds[0], surprise: true } });
      assert.equal(unknown.isError, true);
      assert.match(unknown.content[0].text, /Unrecognized key/);
    });
  } finally { globalThis.fetch = original; }
  assert.equal(calls, 0);
});
