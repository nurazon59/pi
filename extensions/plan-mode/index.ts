import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { createPlanFile, updatePlanFile } from "./plan-file.ts";
import { renderPlanFile, reviewPlan, type PlanFileDisplay, type PlanStep } from "./tui.ts";

const READ_ONLY_TOOLS = new Set([
  "read", "grep", "find", "ls",
  "lsp_diagnostics", "lsp_goto_definition", "lsp_find_references", "lsp_symbols", "lsp_prepare_rename",
  "memory_read", "memory_search", "ask_user",
]);
const DISCOVERY_TOOLS = ["grep", "find", "ls"];
const PLAN_MODE_CONTEXT = "You are in plan mode. Explore the codebase without making changes using the available inspection tools. Shell commands are disabled. Ask for clarification when needed. Finish with a concise numbered plan under a `Plan:` heading. Do not execute the plan.";
const DESIGN_MODE_CONTEXT = `You are in design mode, entered because the user wants the design thoroughly worked through before implementation. Do not rush to produce a plan.

First inspect the relevant code and trace its responsibilities, constraints, and execution flow. Separate facts established by the code from assumptions and decisions that need the user's input. Resolve questions through repository inspection whenever possible; use ask_user to ask the user one focused question at a time when a material product or design choice cannot be established from the code. Incorporate each answer, then continue investigating and ask follow-up questions where it reveals further unresolved choices.

Systematically examine the aspects relevant to this change, including requirements and non-goals, boundaries and responsibilities, data and state, invariants, important flows, edge cases and failure behavior, compatibility or migration, security or performance implications, and verification. Compare meaningful alternatives and explain their trade-offs when a choice matters. Do not invent answers or treat unresolved material choices as settled.

The design is ready only when no unresolved design decisions that could materially change the implementation remain. Then summarize the agreed design, relevant trade-offs, and any remaining uncertainties or risks, followed by a concise numbered implementation plan under a \`Plan:\` heading for user review. Do not modify files or execute the plan.`;

function getAssistantText(message: AgentMessage): string | undefined {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  return (message as AssistantMessage).content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function extractPlan(text: string): PlanStep[] {
  const steps: PlanStep[] = [];
  let inPlan = false;
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.trim().replace(/^#{1,6}[ \t]+/, "").replace(/\*\*/g, "").replace(/[:：][ \t]*$/, "").trim();
    if (/^(?:plan|計画|実装計画)$/i.test(heading)) {
      inPlan = true;
      continue;
    }
    if (!inPlan) continue;
    if (/^[ \t]{0,3}#{1,6}[ \t]+/.test(line)) break;
    const match = line.match(/^[ \t]{0,3}(?:\d+[.)]|[-+*])[ \t]+(.+?)\s*$/);
    const step = match?.[1].replace(/\*\*/g, "").trim();
    if (step) steps.push({ text: step, completed: false });
  }
  return steps;
}

export default function (pi: ExtensionAPI, options?: { agentDir?: string }) {
  let enabled = false;
  let designMode = false;
  let originalTools: string[] | undefined;
  const originalThinking = new Map<string, ReturnType<ExtensionAPI["getThinkingLevel"]>>();
  const savedPlans = new Set<string>();
  const pendingPlans = new Map<string, string>();

  function modelKey(ctx: ExtensionContext): string | undefined {
    return ctx.model ? JSON.stringify([ctx.model.provider, ctx.model.id]) : undefined;
  }

  function applyPlanThinking(ctx: ExtensionContext) {
    const key = modelKey(ctx);
    if (!key) return;
    if (!originalThinking.has(key)) originalThinking.set(key, pi.getThinkingLevel());
    pi.setThinkingLevel("xhigh");
    const level = pi.getThinkingLevel();
    ctx.ui.notify(`Plan mode thinking: ${level}${level === "xhigh" ? "" : " (xhigh unavailable)"}.`, level === "xhigh" ? "info" : "warning");
  }

  function restoreState(ctx: ExtensionContext) {
    if (originalTools) pi.setActiveTools(originalTools);
    originalTools = undefined;
    const key = modelKey(ctx);
    const level = key ? originalThinking.get(key) : undefined;
    if (level !== undefined) pi.setThinkingLevel(level);
    originalThinking.clear();
  }

  function render(ctx: ExtensionContext) {
    ctx.ui.setStatus("plan-mode", enabled ? ctx.ui.theme.fg("warning", "plan") : undefined);
    ctx.ui.setWidget("plan-mode", undefined);
  }

  function setEnabled(value: boolean, ctx: ExtensionContext) {
    enabled = value;
    if (enabled) {
      originalTools ??= pi.getActiveTools();
      const available = new Set(pi.getAllTools().map((tool) => tool.name));
      const tools = originalTools.filter((name) => READ_ONLY_TOOLS.has(name));
      for (const name of DISCOVERY_TOOLS) {
        if (available.has(name) && !tools.includes(name)) tools.push(name);
      }
      pi.setActiveTools(tools);
      applyPlanThinking(ctx);
      ctx.ui.notify("Plan mode: only approved inspection tools are enabled; shell commands are disabled.", "info");
    } else {
      designMode = false;
      restoreState(ctx);
      ctx.ui.notify("Plan mode disabled.", "info");
    }
    pi.events.emit("plan-mode:state", enabled);
    render(ctx);
  }

  pi.events.on("plan-mode:request-state", () => pi.events.emit("plan-mode:state", enabled));

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType === "assistant" && !context.isStreaming && savedPlans.has(markdown.trim())) return "";
    return markdown;
  }, { messageTypes: ["assistant"] });

  pi.registerEntryRenderer<PlanFileDisplay>("plan-file", (entry, _options, theme) => {
    if (!entry.data || typeof entry.data.path !== "string" || typeof entry.data.content !== "string") return;
    return renderPlanFile(entry.data, theme);
  });

  pi.registerTool({
    name: "enter_plan_mode",
    label: "Enter plan mode",
    description: "Enter read-only plan mode before substantial changes that need investigation or a reviewed plan. Use for explicit planning requests or complex, risky work; do not use for simple questions or small changes. Call this tool alone. The user decides whether to approve the plan; do not execute it before approval.",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      designMode = true;
      if (!enabled) setEnabled(true, ctx);
      return {
        content: [{ type: "text", text: DESIGN_MODE_CONTEXT }],
        details: undefined,
      };
    },
  });

  pi.registerFlag("plan", { description: "Start in read-only plan mode", type: "boolean", default: false });
  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode",
    handler: async (_args, ctx) => {
      designMode = false;
      setEnabled(!enabled, ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    designMode = false;
    savedPlans.clear();
    pendingPlans.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "plan-file" && entry.data && typeof entry.data.content === "string") {
        savedPlans.add(entry.data.content.trim());
      }
    }
    if (pi.getFlag("plan") === true) setEnabled(true, ctx);
    else {
      pi.events.emit("plan-mode:state", false);
      render(ctx);
    }
  });

  pi.on("model_select", (_event, ctx) => {
    if (enabled) applyPlanThinking(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    designMode = false;
    if (!enabled) return;
    enabled = false;
    restoreState(ctx);
    pi.events.emit("plan-mode:state", false);
  });

  pi.on("tool_call", (event) => {
    if (enabled && !READ_ONLY_TOOLS.has(event.toolName)) {
      return { block: true, reason: "Plan mode allows only approved inspection tools. Disable it with /plan to run this tool." };
    }
  });

  pi.on("user_bash", () => {
    if (!enabled) return;
    return {
      result: {
        output: "Plan mode disables shell commands. Disable it with /plan to run this command.",
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.on("before_agent_start", () => {
    if (!enabled) return;
    return {
      message: {
        customType: "plan-mode-context",
        display: false,
        content: designMode ? DESIGN_MODE_CONTEXT : PLAN_MODE_CONTEXT,
      },
    };
  });

  pi.on("message_end", async (event, ctx) => {
    if (!enabled) return;
    const plan = getAssistantText(event.message);
    if (!plan || extractPlan(plan).length === 0) return;
    try {
      const path = await createPlanFile(options?.agentDir ?? getAgentDir(), ctx.sessionManager.getSessionId(), plan);
      savedPlans.add(plan.trim());
      pendingPlans.set(plan.trim(), path);
    } catch (error) {
      ctx.ui.notify(`Could not save plan file: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!enabled) return;
    let plan = [...event.messages].reverse().map(getAssistantText).find((text) => text && pendingPlans.has(text.trim()));
    if (!plan) return;
    const path = pendingPlans.get(plan.trim());
    pendingPlans.delete(plan.trim());
    if (!path) return;

    pi.appendEntry<PlanFileDisplay>("plan-file", { path, content: plan });
    render(ctx);
    if (ctx.mode !== "tui") return;

    while (enabled) {
      const review = await reviewPlan(ctx, plan);
      if (review.action === "continue") return;
      if (review.action === "edit" && review.revisedPlan) {
        try {
          await updatePlanFile(path, plan, review.revisedPlan);
        } catch (error) {
          ctx.ui.notify(`Could not update plan file: ${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        }
        plan = review.revisedPlan;
        savedPlans.add(plan.trim());
        pi.appendEntry<PlanFileDisplay>("plan-file", { path, content: plan });
        render(ctx);
        continue;
      }
      if (review.action === "apply") {
        try {
          if (await readFile(path, "utf8") !== plan) throw new Error("Plan file changed outside the review");
        } catch (error) {
          ctx.ui.notify(`Could not verify plan file: ${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        }
        setEnabled(false, ctx);
        pi.sendUserMessage(`Execute this approved plan in order.\n\n${plan}`, { deliverAs: "followUp" });
        return;
      }
    }
  });
}
