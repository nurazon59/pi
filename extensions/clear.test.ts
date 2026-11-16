import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import clear from "./clear.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    let handler: ((args: string, context: any) => Promise<void>) | undefined;
    const mock = {
      registerCommand(name: string, definition: { handler: typeof handler }) {
        if (name !== "clear") throw new Error("Expected /clear command");
        handler = definition.handler;
      },
    };
    clear(mock as unknown as ExtensionAPI);
    if (!handler) throw new Error("/clear command not registered");
    let calls = 0;
    await handler("", { async newSession() { calls++; return { cancelled: false }; } });
    if (calls !== 1) throw new Error("/clear did not start a new session");
    await handler("", { async newSession() { calls++; return { cancelled: true }; } });
    if (calls !== 2) throw new Error("/clear did not respect cancelled session creation");
    ctx.ui.notify("Clear command tests passed", "info");
  });
}
