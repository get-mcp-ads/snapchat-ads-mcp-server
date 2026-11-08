/**
 * Every outbound call carries a bearer token or a client secret. Following a
 * redirect would forward that credential to whatever host the redirect names,
 * so no fetch in this codebase may omit `redirect: "error"`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function sourceFiles(dir = "src", acc = []) {
  for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(`${dir}/${entry.name}`, acc);
    else if (entry.name.endsWith(".ts")) acc.push(`${dir}/${entry.name}`);
  }
  return acc;
}

test("every fetch refuses to follow redirects", () => {
  const offenders = [];
  let calls = 0;
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    let index = text.indexOf("fetch(");
    while (index !== -1) {
      calls++;
      // The options object of a fetch call ends at the first `});` that follows.
      const tail = text.slice(index, index + 1200);
      const end = tail.indexOf("});");
      const call = end === -1 ? tail : tail.slice(0, end);
      if (!call.includes('redirect: "error"')) offenders.push(`${file}:${text.slice(0, index).split("\n").length}`);
      index = text.indexOf("fetch(", index + 1);
    }
  }
  assert.ok(calls >= 2, "the scan found the API and token calls");
  assert.deepEqual(offenders, [], `These fetch calls may follow a redirect and leak credentials: ${offenders.join(", ")}`);
});

test("the only hosts this server can reach are Snap's API and token hosts", () => {
  const hosts = new Set();
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].replace(/\.$/, "").toLowerCase();
      // Links in comments, server metadata and returned documentation are not call targets.
      if (["www.getmcpads.com", "mcp.getmcpads.com", "developers.snap.com"].includes(host)) continue;
      hosts.add(host);
    }
  }
  assert.deepEqual([...hosts].sort(), ["accounts.snapchat.com", "adsapi.snapchat.com"],
    "A new outbound host appeared. That is a deliberate decision, not an accident.");
});

test("hosts are declared in one module", () => {
  const offenders = sourceFiles().filter((file) => !file.endsWith("hosts.ts")).filter((file) =>
    /https:\/\/(adsapi|accounts)\.snapchat\.com/.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
  assert.deepEqual(offenders, []);
});
