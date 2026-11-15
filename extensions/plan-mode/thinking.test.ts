import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import planMode from "./index.ts";

type Level = "off" | "low" | "medium" | "high" | "xhigh";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, testContext) => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-plan-thinking-test-"));
    function setup(startPlan = false, max: Level = "xhigh") {
      const handlers: Record<string, (...args: any[]) => any> = {};
      let toggle: (...args: any[]) => Promise<void> = async () => {};
      let enterTool: any;
      let markdownTransformer: ((markdown: string, context: { messageType: string; isStreaming: boolean }) => string) | undefined;
      const events: Array<{ channel: string; data: unknown }> = [];
      let active = ["read", "bash", "edit", "enter_plan_mode"];
      let level: Level = "high";
      let sent = "";
      let editText = "";
      let onReview: (() => Promise<void>) | undefined;
      const decisions: string[] = [];
      const notifications: string[] = [];
      const widgets: Array<unknown> = [];
      const entries: Array<{ path: string; content: string }> = [];
      const branchEntries: Array<{ type: string; customType?: string; data?: { path: string; content: string } }> = [];
      const ctx = {
        model: { provider: "test", id: "a" },
        mode: "tui",
        sessionManager: {
          getSessionId() { return "test-session"; },
          getBranch() { return branchEntries; },
        },
        hasUI: true,
        ui: {
          setStatus() {}, setWidget(_name: string, value: unknown) { widgets.push(value); }, notify(message: string) { notifications.push(message); },
          theme: { fg: (_: string, text: string) => text },
          async custom() { await onReview?.(); return decisions.shift() ?? "apply"; },
          async editor() { return editText; },
        },
      };
      const mock = {
        on(name: string, handler: (...args: any[]) => any) { handlers[name] = handler; },
        registerCommand(_name: string, definition: { handler: typeof toggle }) { toggle = definition.handler; },
        registerFlag() {}, getFlag() { return startPlan; },
        registerTool(tool: unknown) { enterTool = tool; },
        registerEntryRenderer() {},
        registerMarkdownTransformer(transformer: typeof markdownTransformer) { markdownTransformer = transformer; },
        appendEntry(type: string, data: { path: string; content: string }) {
          entries.push(data);
          branchEntries.push({ type: "custom", customType: type, data });
        },
        events: { emit(channel: string, data: unknown) { events.push({ channel, data }); }, on() { return () => {}; } },
        getActiveTools() { return active; },
        getAllTools() { return ["read", "bash", "edit", "grep", "find", "ls"].map((name) => ({ name })); },
        setActiveTools(value: string[]) { active = value; },
        getThinkingLevel() { return level; },
        setThinkingLevel(value: Level) { level = value === "xhigh" ? max : value; },
        sendUserMessage(message: string) { sent = message; },
      };
      planMode(mock as unknown as ExtensionAPI, { agentDir });
      return {
        ctx, handlers, notifications,
        toggle: () => toggle("", ctx),
        getLevel: () => level,
        setLevel(value: Level) { level = value; },
        getTools: () => active,
        getSent: () => sent,
        enter: () => enterTool.execute("test", {}, undefined, undefined, ctx),
        events, entries, decisions, widgets,
        async finish(messages: any[]) {
          for (const message of messages) await handlers.message_end({ message }, ctx);
          await handlers.agent_end({ messages }, ctx);
        },
        transform(markdown: string, isStreaming = false) {
          if (!markdownTransformer) throw new Error("Markdown transformer was not registered");
          return markdownTransformer(markdown, { messageType: "assistant", isStreaming });
        },
        setEdit(text: string) { editText = text; },
        setOnReview(handler: () => Promise<void>) { onReview = handler; },
      };
    }
    function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }

    const automatic = setup();
    await automatic.enter();
    assert(automatic.getLevel() === "xhigh" && !automatic.getTools().includes("bash"), "AI entry");
    assert(automatic.events.some((event) => event.channel === "plan-mode:state" && event.data === true), "plan state event");
    await automatic.toggle();
    assert(automatic.getLevel() === "high" && automatic.getTools().includes("bash"), "AI entry restore");
    assert(automatic.events.some((event) => event.channel === "plan-mode:state" && event.data === false), "build state event");

    const manual = setup();
    await manual.toggle();
    assert(manual.getLevel() === "xhigh", "manual enable");
    await manual.toggle();
    assert(manual.getLevel() === "high" && manual.getTools().includes("bash"), "manual restore");

    const startup = setup(true);
    startup.handlers.session_start({}, startup.ctx);
    assert(startup.getLevel() === "xhigh", "startup enable");
    startup.handlers.session_shutdown({}, startup.ctx);
    assert(startup.getLevel() === "high" && startup.getTools().includes("bash"), "reload restore");

    const unsupported = setup(false, "medium");
    unsupported.setLevel("low");
    await unsupported.toggle();
    assert(unsupported.getLevel() === "medium", "unsupported clamp");
    assert(unsupported.notifications.some((message) => message.includes("medium")), "unsupported notification");
    await unsupported.toggle();
    assert(unsupported.getLevel() === "low", "unsupported restore");

    const changed = setup();
    await changed.toggle();
    changed.ctx.model = { provider: "test", id: "b" };
    changed.setLevel("low");
    changed.handlers.model_select({ model: changed.ctx.model }, changed.ctx);
    assert(changed.getLevel() === "xhigh", "new model plan level");
    await changed.toggle();
    assert(changed.ctx.model.id === "b" && changed.getLevel() === "low", "new model restore");

    const switchedBack = setup();
    await switchedBack.toggle();
    switchedBack.ctx.model = { provider: "test", id: "b" };
    switchedBack.setLevel("low");
    switchedBack.handlers.model_select({ model: switchedBack.ctx.model }, switchedBack.ctx);
    switchedBack.ctx.model = { provider: "test", id: "a" };
    switchedBack.setLevel("medium");
    switchedBack.handlers.model_select({ model: switchedBack.ctx.model }, switchedBack.ctx);
    await switchedBack.toggle();
    assert(switchedBack.getLevel() === "high", "original model restore after switching back");

    const applied = setup();
    await applied.toggle();
    const appliedPlan = "Plan:\n1. Inspect";
    const appliedMessage = { role: "assistant", content: [{ type: "text", text: appliedPlan }] };
    assert(applied.transform(appliedPlan, true) === appliedPlan, "streaming plan remains visible");
    assert(applied.transform(appliedPlan) === appliedPlan, "plan remains visible until persistence succeeds");
    await applied.handlers.message_end({ message: appliedMessage }, applied.ctx);
    assert(applied.transform(appliedPlan) === "", "saved plan transcript hidden before message-end rendering");
    await applied.handlers.agent_end({ messages: [appliedMessage] }, applied.ctx);
    assert(applied.widgets.every((widget) => widget === undefined), "plan widget does not duplicate the card");
    applied.handlers.session_start({}, applied.ctx);
    assert(applied.transform(appliedPlan) === "", "saved plan transcript stays hidden after reload");
    assert(applied.getLevel() === "high" && applied.getTools().includes("bash"), "apply restore");
    assert(applied.getSent().includes("Inspect"), "apply message");
    assert(applied.entries.length === 1, "plan entry");
    assert(await readFile(applied.entries[0].path, "utf8") === applied.entries[0].content, "saved plan content");

    for (const heading of ["## Plan:", "# Plan:", "## Plan", "**Plan:**", "**Plan**:", "## 計画", "実装計画：", "### **実装計画**"]) {
      const formatted = setup();
      await formatted.toggle();
      const text = `計画を整理します。\n\n${heading}\n\n1. **D1のデータ構造を追加する**\n   - 既存データを保持する。`;
      await formatted.finish([{ role: "assistant", content: [{ type: "text", text }] }]);
      assert(formatted.entries.length === 1 && formatted.getSent().endsWith(text), `formatted plan triggers review: ${heading}`);
    }

    const bulleted = setup();
    await bulleted.toggle();
    const bulletPlan = "## 実装計画\n\n- データ構造を追加する\n- テストする";
    await bulleted.finish([{ role: "assistant", content: [{ type: "text", text: bulletPlan }] }]);
    assert(bulleted.entries.length === 1 && bulleted.getSent().endsWith(bulletPlan), "bulleted plan triggers review");

    for (const text of ["## Plan:\n調査について確認します。", "```markdown\n## Plan:\n1. Example\n```", "## Plan:\n説明のみ。\n\n## 参考\n1. 別の項目"]) {
      const notPlan = setup();
      await notPlan.toggle();
      await notPlan.finish([{ role: "assistant", content: [{ type: "text", text }] }]);
      assert(notPlan.entries.length === 0 && !notPlan.getSent(), "non-plan does not trigger review");
    }

    const edited = setup();
    edited.decisions.push("edit", "apply");
    const revised = "背景の説明。\n\nPlan:\n1. 編集後の内容\n   長い条件も残す。\n\n注意: 保存する。";
    edited.setEdit(revised);
    await edited.toggle();
    await edited.finish([{ role: "assistant", content: [{ type: "text", text: "Plan:\n1. 修正前" }] }]);
    assert(edited.entries.length === 2 && edited.entries[0].path === edited.entries[1].path, "edited entry");
    assert(await readFile(edited.entries[1].path, "utf8") === revised, "edited file");
    assert(edited.transform("Plan:\n1. 修正前") === "", "original plan hidden after edit");
    assert(edited.transform(revised) === "", "revised plan hidden after edit");
    assert(edited.getSent().endsWith(revised), "exact approved plan");

    const conflicted = setup();
    conflicted.setOnReview(async () => { await writeFile(conflicted.entries[0].path, "external edit"); });
    await conflicted.toggle();
    await conflicted.finish([{ role: "assistant", content: [{ type: "text", text: "Plan:\n1. Before" }] }]);
    assert(!conflicted.getSent() && !conflicted.getTools().includes("bash"), "external edit blocked");
    assert(conflicted.notifications.some((message) => message.includes("Could not verify")), "external edit notification");

    const editConflict = setup();
    editConflict.decisions.push("edit");
    editConflict.setEdit("Plan:\n1. Revised");
    editConflict.setOnReview(async () => { await writeFile(editConflict.entries[0].path, "external edit"); });
    await editConflict.toggle();
    await editConflict.finish([{ role: "assistant", content: [{ type: "text", text: "Plan:\n1. Before" }] }]);
    assert(!editConflict.getSent() && editConflict.entries.length === 1, "edit conflict blocked");
    assert(editConflict.notifications.some((message) => message.includes("Could not update")), "edit conflict notification");

    const rpc = setup();
    rpc.ctx.mode = "rpc";
    await rpc.toggle();
    await rpc.finish([{ role: "assistant", content: [{ type: "text", text: "Plan:\n1. RPC" }] }]);
    assert(rpc.entries.length === 1 && !rpc.getSent(), "RPC saves without TUI approval");

    const invalid = setup();
    invalid.ctx.sessionManager.getSessionId = () => "../invalid";
    await invalid.toggle();
    const invalidMessage = { role: "assistant", content: [{ type: "text", text: "Plan:\n1. Before" }] };
    await invalid.handlers.message_end({ message: invalidMessage }, invalid.ctx);
    assert(invalid.transform("Plan:\n1. Before") === "Plan:\n1. Before", "plan remains visible after save failure");
    await invalid.handlers.agent_end({ messages: [invalidMessage] }, invalid.ctx);
    assert(!invalid.getSent() && invalid.entries.length === 0, "failed save blocked");
    assert(invalid.transform("Plan:\n1. Before") === "Plan:\n1. Before", "plan remains visible after save failure");
    assert(invalid.notifications.some((message) => message.includes("Could not save")), "failed save notification");
    await rm(agentDir, { recursive: true, force: true });
    testContext.ui.notify("Plan thinking tests passed", "info");
  });
}
