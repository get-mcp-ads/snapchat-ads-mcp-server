import { SnapClient, type SnapClientOptions } from "../../src/platforms/snapchat/client.js";
import { registerSnapReads, registerSnapWrites } from "../../src/platforms/snapchat/tools.js";

export const ACCOUNT = "e2388280-66d3-4e8e-a720-2f7a7d261a24";
export const OTHER = "7a544b38-3037-42ec-8514-464610058e8c";

type Tool = { name: string; description: string; shape: Record<string, unknown>; handler: (args: any) => Promise<any>; write: boolean };

/** Register every tool on a stand-in server, with test credentials and one allowed account. */
export function collect(options: Partial<SnapClientOptions> = {}) {
  const tools: Tool[] = [];
  const collector = { tool(name: string, description: string, shape: any, handler: any) { tools.push({ name, description, shape, handler, write: Object.hasOwn(shape, "confirm") }); } };
  const api = new SnapClient({ accessToken: "TEST_TOKEN", allowedAccountIds: [ACCOUNT], ...options });
  registerSnapReads(collector, api);
  registerSnapWrites(collector, api);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`No tool ${name}`);
    const r = await tool.handler({ ...(Object.hasOwn(tool.shape, "adAccountId") ? { adAccountId: ACCOUNT } : {}), ...args });
    return { error: r.isError as boolean | undefined, data: JSON.parse(r.content[0].text), text: r.content[0].text as string };
  }
  return { tools, api, call };
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
/** Snap wraps one entity as `{ campaigns: [{ campaign: {...} }] }`. */
export const native = (kind: string, value: object) => json({ request_status: "SUCCESS", [kind === "media" ? "media" : kind + "s"]: [{ [kind]: value }] });
