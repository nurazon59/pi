import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import projectMemory from "./project-memory.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const packagePath = process.env.PI_MEMORY_EXTENSION;
    if (!packagePath) throw new Error("Set PI_MEMORY_EXTENSION to the installed pi-memory index.ts");
    const root = await mkdtemp(join(tmpdir(), "pi-memory-integration-"));
    try {
      const memory = await import(packagePath);
      memory._setBaseDir(root);
      await writeFile(join(root, "MEMORY.md"), "Shared long-term memory");
      const handlers: Record<string, Array<(...args: any[]) => any>> = {};
      const tools = new Map<string, any>();
      const mock = {
        on(name: string, handler: (...args: any[]) => any) { (handlers[name] ??= []).push(handler); },
        registerTool(tool: { name: string }) { tools.set(tool.name, tool); },
      };
      memory.default(mock as unknown as ExtensionAPI);
      projectMemory(mock as unknown as ExtensionAPI, { memoryDir: root, index: false });
      const testCtx = { cwd: root };
      await handlers.session_start[1]({}, testCtx);
      await tools.get("project_memory").execute("test", { action: "write", content: "Specific project memory" }, undefined, undefined, testCtx);
      let systemPrompt = "Base prompt";
      for (const handler of handlers.before_agent_start) {
        const result = await handler({ systemPrompt, prompt: "test" }, testCtx);
        systemPrompt = result?.systemPrompt ?? systemPrompt;
      }
      if (!systemPrompt.includes("Shared long-term memory") || !systemPrompt.includes("Specific project memory")) {
        throw new Error("Common and project memory were not both included");
      }
      if (!tools.has("memory_write") || !tools.has("memory_search") || !tools.has("project_memory")) {
        throw new Error("Existing memory tools were not preserved");
      }
      ctx.ui.notify("Project memory integration tests passed", "info");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
