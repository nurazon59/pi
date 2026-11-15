import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderPlanBorder } from "../contextual-ctrl-p.ts";
import { renderPlanFile } from "./tui.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const vim = " NORMAL ";
    const border = "\x1b[35m" + "─".repeat(32) + "\x1b[0m\x1b[7m" + vim + "\x1b[27m";
    const width = visibleWidth(border);
    const rendered = renderPlanBorder(border, width, " PLAN ", vim, (text) => text);
    const plain = stripTerminalSequences(rendered);
    if (!rendered.includes(vim + "\x1b[0m")) throw new Error("Vim label style leaked into the border");
    if (!plain.startsWith(" PLAN " + vim) || plain.indexOf(vim, " PLAN ".length + vim.length) !== -1 || visibleWidth(rendered) !== width) {
      throw new Error("Vim label was not placed only next to the plan label or width changed");
    }
    const narrow = "────" + vim;
    if (renderPlanBorder(narrow, visibleWidth(narrow), " BUILD ", vim, (text) => text) !== narrow) {
      throw new Error("Narrow border did not preserve the Vim label");
    }
    const card = renderPlanFile({ path: "/tmp/プラン.md", content: `# 計画\n\n1. ${"長い日本語の説明".repeat(20)}` }, ctx.ui.theme);
    const full = card.render(80).join("\n");
    if (!full.includes("Plan file") || !full.includes("プラン.md") || !full.includes("計画")) {
      throw new Error("Plan file header or content missing");
    }
    for (const columns of [1, 2, 5, 12, 40, 80]) {
      for (const line of card.render(columns)) {
        if (visibleWidth(line) > columns) throw new Error(`Plan card exceeded width ${columns}`);
      }
      card.invalidate();
    }
    ctx.ui.notify("Plan UI tests passed", "info");
  });
}
