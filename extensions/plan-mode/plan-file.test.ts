import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPlanFile, updatePlanFile } from "./plan-file.ts";

test("plan files preserve full content, isolate sessions and update safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-plan-file-test-"));
  try {
    const first = "説明です。\n\nPlan:\n1. 日本語を確認する。\n   詳細も残す。\n\n## 注意\n長い説明";
    const edited = "Plan:\n1. 編集済み\n\n追加の条件。";
    const path = await createPlanFile(root, "session-one", first);
    const other = await createPlanFile(root, "session-two", first);
    assert.notEqual(path, other);
    assert.equal(await readFile(path, "utf8"), first);
    await assert.rejects(updatePlanFile(path, "outdated", edited));
    assert.equal(await readFile(path, "utf8"), first);
    await updatePlanFile(path, first, edited);
    assert.equal(await readFile(path, "utf8"), edited);
    assert.equal(await readFile(other, "utf8"), first);
    await assert.rejects(createPlanFile(root, "../escape", first));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
