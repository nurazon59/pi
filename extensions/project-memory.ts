import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const MAX_CHARS = 4000;

async function projectIdentity(cwd: string): Promise<string> {
  const directory = await realpath(cwd);
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  try {
    const { stdout } = await execFileAsync("git", ["-C", directory, "rev-parse", "--git-common-dir"], { env, timeout: 5000 });
    return `git:${await realpath(resolve(directory, stdout.trim()))}`;
  } catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" && error.stderr.includes("not a git repository")) {
      return `directory:${directory}`;
    }
    throw error;
  }
}

async function readMemory(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export default function (pi: ExtensionAPI, options?: { memoryDir?: string; index?: boolean }) {
  const memoryDir = options?.memoryDir ?? (process.env.PI_MEMORY_DIR || join(homedir(), ".pi", "agent", "memory"));
  let path: string | undefined;
  let snapshot: string | undefined;
  let indexing = false;
  let pendingIndex = false;
  let stopping = false;
  let indexProcess: ReturnType<typeof execFile> | undefined;

  function updateIndex() {
    if (stopping || options?.index === false || (process.env.PI_MEMORY_QMD_UPDATE ?? "background").toLowerCase() !== "background") return;
    if (indexing) {
      pendingIndex = true;
      return;
    }
    indexing = true;
    const finish = () => {
      indexProcess = undefined;
      indexing = false;
      if (pendingIndex && !stopping) {
        pendingIndex = false;
        updateIndex();
      }
    };
    indexProcess = execFile("qmd", ["update"], { timeout: 30000 }, (error) => {
      if (error || stopping) return finish();
      indexProcess = execFile("qmd", ["embed"], { timeout: 600000 }, finish);
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    stopping = false;
    path = undefined;
    snapshot = undefined;
    const identity = await projectIdentity(ctx.cwd);
    const id = createHash("sha256").update(identity).digest("hex");
    path = join(memoryDir, "projects", `${id}.md`);
    snapshot = await readMemory(path);
  });

  pi.on("session_shutdown", () => {
    stopping = true;
    pendingIndex = false;
    indexProcess?.kill();
  });

  pi.on("before_agent_start", (event) => {
    if (!path) return;
    const content = snapshot === undefined ? "No project memory exists yet." : snapshot.length > MAX_CHARS ? `${snapshot.slice(0, MAX_CHARS)}\n[Project memory truncated.]` : snapshot;
    return {
      systemPrompt: `${event.systemPrompt}\n\n## Project memory\nPersonal project memory may be outdated. Current code, AGENTS.md, and explicit user instructions take precedence. Use project_memory to maintain concise project-specific decisions and active context. Use memory_write for common preferences and daily history.\n\n${content}`,
    };
  });

  pi.registerTool({
    name: "project_memory",
    label: "Project memory",
    description: "Read or replace the current project's personal memory. Record concise project-specific decisions and active context; use memory_write for shared preferences and daily history. Read before updating and preserve relevant existing facts. Current code and AGENTS.md take precedence. Maximum 4000 characters.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("read"), Type.Literal("write")]),
      content: Type.Optional(Type.String({ description: "Complete replacement Markdown, required for write (maximum 4000 characters)." })),
    }),
    executionMode: "sequential",
    async execute(_id, { action, content }, signal) {
      if (!path) throw new Error("Project memory is not initialized.");
      const currentPath = path;
      if (action === "read") {
        const current = await readMemory(currentPath);
        const text = current === undefined ? "No project memory exists yet." : current.length > MAX_CHARS ? `${current.slice(0, MAX_CHARS)}\n[Project memory truncated; read the file directly for the full content.]` : current;
        return { content: [{ type: "text", text }], details: { path: currentPath } };
      }
      if (content === undefined || content.length > MAX_CHARS) throw new Error("Project memory content is required and must not exceed 4000 characters.");
      await withFileMutationQueue(currentPath, async () => {
        if (signal?.aborted) throw new Error("Operation aborted");
        const current = await readMemory(currentPath);
        if (current !== snapshot) throw new Error("Project memory changed since the snapshot. Read it and restart or reload before updating.");
        await mkdir(dirname(currentPath), { recursive: true, mode: 0o700 });
        const temporary = `${currentPath}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
          if (signal?.aborted) throw new Error("Operation aborted");
          await rename(temporary, currentPath);
        } finally {
          await rm(temporary, { force: true });
        }
        snapshot = content;
      });
      updateIndex();
      return { content: [{ type: "text", text: "Project memory saved and snapshot updated." }], details: { path: currentPath } };
    },
  });
}
