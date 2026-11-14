import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import planMode from "./index.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, testContext) => {
    const handlers: Record<string, (...args: any[]) => any> = {};
    let toggle: (...args: any[]) => Promise<void> = async () => {};
    let active = ["read", "bash", "edit", "write", "lsp_diagnostics", "lsp_rename", "memory_write", "ask_user"];
    const initial = [...active];
    const mock = {
      on(name: string, handler: (...args: any[]) => any) { handlers[name] = handler; },
      registerCommand(_name: string, definition: { handler: typeof toggle }) { toggle = definition.handler; },
      registerFlag() {},
      registerTool() {},
      registerEntryRenderer() {},
      registerMarkdownTransformer() {},
      events: { emit() {}, on() { return () => {}; } },
      getFlag() { return false; },
      getActiveTools() { return active; },
      getAllTools() { return [...initial, "grep", "find", "ls"].map((name) => ({ name })); },
      setActiveTools(names: string[]) { active = names; },
    };
    const ctx = { ui: { setStatus() {}, setWidget() {}, notify() {}, theme: { fg: (_: string, value: string) => value } } };
    planMode(mock as unknown as ExtensionAPI);
    await toggle("", ctx);

    for (const name of ["read", "grep", "find", "ls", "lsp_diagnostics", "ask_user"]) {
      if (!active.includes(name)) throw new Error(`Missing inspection tool: ${name}`);
    }
    for (const name of ["bash", "edit", "write", "lsp_rename", "memory_write", "unknown_tool"]) {
      if (active.includes(name)) throw new Error(`Unexpected active tool: ${name}`);
      if (!handlers.tool_call({ toolName: name, input: {} })?.block) throw new Error(`Tool not blocked: ${name}`);
    }
    if (handlers.tool_call({ toolName: "read", input: {} })?.block) throw new Error("Read was blocked");
    if (handlers.user_bash({ command: "git branch -D main" })?.result?.exitCode !== 1) {
      throw new Error("User shell command was not blocked");
    }

    await toggle("", ctx);
    if (JSON.stringify(active) !== JSON.stringify(initial)) throw new Error("Tools were not restored");
    if (handlers.tool_call({ toolName: "lsp_rename", input: {} })?.block) throw new Error("Tool remained blocked");
    if (handlers.user_bash({ command: "pwd" })) throw new Error("User shell remained blocked");
    testContext.ui.notify("Plan safety tests passed", "info");
  });
}
