import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Key, Markdown, Text, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

export interface PlanStep {
  text: string;
  completed: boolean;
}

export interface PlanFileDisplay {
  path: string;
  content: string;
}

export function renderPlanFile(data: PlanFileDisplay, theme: Theme): Component {
  function createBox(): Box {
    const box = new Box(1, 0, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(`Plan file  ${data.path}`)), 0, 0));
    box.addChild(new Markdown(data.content, 0, 0, getMarkdownTheme()));
    return box;
  }
  let box = createBox();
  return {
    render(width) {
      if (width <= 0) return [];
      return box.render(width).map((line) => truncateToWidth(line, width, ""));
    },
    invalidate() { box = createBox(); },
  };
}

export type PlanAction = "apply" | "edit" | "continue";

export async function reviewPlan(
  ctx: ExtensionContext,
  plan: string,
): Promise<{ action: PlanAction; revisedPlan?: string }> {
  const action = await ctx.ui.custom<PlanAction>((tui, theme, _keybindings, done) => {
    const choices: { label: string; action: PlanAction }[] = [
      { label: "Apply and execute (exit Plan mode)", action: "apply" },
      { label: "Edit plan", action: "edit" },
      { label: "Keep planning", action: "continue" },
    ];
    let cursor = 0;
    let cachedLines: string[] | undefined;
    let cachedWidth: number | undefined;

    function refresh() {
      cachedLines = undefined;
      tui.requestRender();
    }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up) || data === "k" || data === "K") {
        cursor = Math.max(0, cursor - 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.down) || data === "j" || data === "J") {
        cursor = Math.min(choices.length - 1, cursor + 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        done(choices[cursor].action);
        return;
      }
      if (matchesKey(data, Key.escape)) done("continue");
    }

    function render(width: number): string[] {
      if (cachedLines && cachedWidth === width) return cachedLines;
      const renderWidth = Math.max(1, width);
      const lines = [theme.fg("accent", "Plan ready")];
      lines.push("");
      for (let i = 0; i < choices.length; i++) {
        const selected = i === cursor;
        const prefix = selected ? theme.fg("accent", "> ") : "  ";
        const label = theme.fg(selected ? "accent" : "text", choices[i].label);
        const prefixWidth = visibleWidth(prefix);
        const wrapped = wrapTextWithAnsi(label, Math.max(1, renderWidth - prefixWidth));
        for (let line = 0; line < wrapped.length; line++) {
          lines.push(`${line === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[line]}`);
        }
      }
      lines.push("");
      lines.push(...wrapTextWithAnsi(theme.fg("dim", "↑↓/jk navigate • Enter select • Esc keep planning"), renderWidth));
      cachedWidth = width;
      cachedLines = lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
      return cachedLines;
    }

    return {
      render,
      invalidate: () => {
        cachedLines = undefined;
      },
      handleInput,
    };
  });

  if (action !== "edit") return { action };

  const revisedPlan = await ctx.ui.editor("Edit the plan, then submit to review it again", plan);
  return revisedPlan?.trim() ? { action: "edit", revisedPlan } : { action: "continue" };
}
