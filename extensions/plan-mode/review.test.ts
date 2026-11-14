import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { reviewPlan } from "./tui.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    async function run(keys: string[], revised?: string) {
      let initial = "";
      const fake = {
        ui: {
          async custom(factory: any) {
            let result: string | undefined;
            const component = factory({ requestRender() {} }, { fg: (_: string, text: string) => text }, {}, (value: string) => { result = value; });
            for (const width of [80, 1, 12, 40]) {
              for (const line of component.render(width)) {
                if (visibleWidth(line) > width) throw new Error(`Review exceeded width ${width}`);
              }
            }
            for (const key of keys) component.handleInput(key);
            return result;
          },
          async editor(_title: string, value: string) { initial = value; return revised; },
        },
      };
      const result = await reviewPlan(fake as unknown as ExtensionContext, "Plan:\n1. 日本語\n\n詳細です。");
      return { result, initial };
    }
    if ((await run(["\r"])).result.action !== "apply") throw new Error("Apply not selected");
    const edit = await run(["j", "\r"], "Plan:\n1. 編集済み\n\n全文");
    if (edit.result.revisedPlan !== "Plan:\n1. 編集済み\n\n全文" || !edit.initial.includes("詳細です。")) throw new Error("Edit did not preserve full text");
    if ((await run(["\x1b"])).result.action !== "continue") throw new Error("Escape did not cancel");
    ctx.ui.notify("Plan review tests passed", "info");
  });
}
