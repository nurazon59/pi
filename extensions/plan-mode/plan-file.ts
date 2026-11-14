import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function createPlanFile(agentDir: string, sessionId: string, content: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid session ID");
  const directory = join(agentDir, "plans", sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${randomUUID()}.md`);
  await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return path;
}

export async function updatePlanFile(path: string, expected: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (await readFile(path, "utf8") !== expected) throw new Error("Plan file changed outside the review");
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
