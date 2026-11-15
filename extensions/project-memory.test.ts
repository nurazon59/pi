import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import projectMemory from "./project-memory.ts";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, testContext) => {
    const root = await mkdtemp(join(tmpdir(), "pi-project-memory-test-"));
    const git = (...args: string[]) => execFileSync("git", args, { stdio: "pipe" });
    const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    try {
      const repo = join(root, "repo");
      const subdir = join(repo, "subdir");
      const worktree = join(root, "worktree");
      const other = join(root, "other");
      const memoryDir = join(root, "memory");
      await mkdir(subdir, { recursive: true });
      await mkdir(other);
      git("init", repo);
      git("-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial");
      git("-C", repo, "worktree", "add", "--detach", worktree);

      function setup(cwd: string, index = false) {
        const handlers: Record<string, (...args: any[]) => any> = {};
        let tool: any;
        const mock = {
          on(name: string, handler: (...args: any[]) => any) { handlers[name] = handler; },
          registerTool(value: unknown) { tool = value; },
        };
        projectMemory(mock as unknown as ExtensionAPI, { memoryDir, index });
        const ctx = { cwd };
        return {
          async start() { await handlers.session_start({}, ctx); },
          prompt(base = "base") { return handlers.before_agent_start({ systemPrompt: base }, ctx); },
          async call(params: unknown) { return tool.execute("test", params, undefined, undefined, ctx); },
        };
      }
      const first = setup(repo);
      await first.start();
      assert(first.prompt().systemPrompt.includes("No project memory exists yet."), "missing project memory is explained");
      const missing = await first.call({ action: "read" });
      assert(missing.content[0].text.includes("No project memory"), "missing memory read");
      await first.call({ action: "write", content: "# Project\n- A decision" });
      assert(first.prompt("common memory").systemPrompt.includes("common memory"), "common memory preserved");
      assert(first.prompt().systemPrompt.includes("A decision"), "saved memory injected");
      assert(first.prompt().systemPrompt.includes("AGENTS.md"), "source precedence guidance");
      const stored = await first.call({ action: "read" });
      assert(stored.content[0].text.includes("A decision"), "read saved memory");
      const sub = setup(subdir);
      const wt = setup(worktree);
      await sub.start();
      await wt.start();
      assert(sub.prompt().systemPrompt.includes("A decision"), "subdirectory identity");
      assert(wt.prompt().systemPrompt.includes("A decision"), "worktree identity");
      const unrelated = setup(other);
      await unrelated.start();
      assert(!unrelated.prompt().systemPrompt.includes("A decision"), "unrelated directory isolation");
      await unrelated.call({ action: "write", content: "Non-git memory" });
      assert(unrelated.prompt().systemPrompt.includes("Non-git memory"), "non-git write");
      assert(!first.prompt().systemPrompt.includes("Non-git memory"), "project isolation");
      await first.call({ action: "write", content: "Updated" });
      assert(first.prompt().systemPrompt.includes("Updated"), "write refreshes snapshot");
      assert(wt.prompt().systemPrompt.includes("A decision"), "other session snapshot remains stable");
      await wt.start();
      assert(wt.prompt().systemPrompt.includes("Updated"), "session restart refreshes snapshot");
      let rejected = false;
      try { await first.call({ action: "write", content: "x".repeat(4001) }); } catch { rejected = true; }
      assert(rejected, "oversized write rejected");
      assert(first.prompt().systemPrompt.includes("Updated"), "rejected write preserves data");
      const path = stored.details.path;
      await writeFile(path, "external change");
      let conflict = false;
      try { await first.call({ action: "write", content: "overwrite" }); } catch { conflict = true; }
      assert(conflict && await readFile(path, "utf8") === "external change", "external changes are not overwritten");
      assert(first.prompt().systemPrompt.includes("Updated"), "external change does not alter snapshot");
      await first.start();
      assert(first.prompt().systemPrompt.includes("external change"), "restart loads external changes");
      assert((await readFile(path, "utf8")) === "external change", "project memory stored on disk");
      const bin = join(root, "bin");
      const log = join(root, "qmd.log");
      await mkdir(bin);
      await writeFile(join(bin, "qmd"), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$QMD_TEST_LOG"\n');
      await chmod(join(bin, "qmd"), 0o755);
      const previousPath = process.env.PATH;
      const previousMode = process.env.PI_MEMORY_QMD_UPDATE;
      const previousLog = process.env.QMD_TEST_LOG;
      try {
        process.env.PATH = `${bin}:${previousPath}`;
        process.env.PI_MEMORY_QMD_UPDATE = "background";
        process.env.QMD_TEST_LOG = log;
        const indexed = setup(other, true);
        await indexed.start();
        await indexed.call({ action: "write", content: "Indexed memory" });
        let lines = "";
        for (let i = 0; i < 100 && !lines.includes("embed"); i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          try { lines = await readFile(log, "utf8"); } catch {}
        }
        assert(lines === "update\nembed\n", "background qmd update and embed");
        process.env.PI_MEMORY_QMD_UPDATE = "off";
        await indexed.call({ action: "write", content: "Index disabled" });
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert(await readFile(log, "utf8") === lines, "qmd disabled mode");
      } finally {
        if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
        if (previousMode === undefined) delete process.env.PI_MEMORY_QMD_UPDATE; else process.env.PI_MEMORY_QMD_UPDATE = previousMode;
        if (previousLog === undefined) delete process.env.QMD_TEST_LOG; else process.env.QMD_TEST_LOG = previousLog;
      }
      testContext.ui.notify("Project memory tests passed", "info");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
