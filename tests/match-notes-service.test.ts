import assert from "node:assert/strict";
import test from "node:test";
import {
  getUserMatchNotes,
  parsePersonalMatchNoteIds,
  updateUserMatchNote,
} from "../app/server/match-notes-service";
import { mergePersonalMatchNote } from "../app/match-notes";
import { SqliteD1 } from "./helpers/sqlite-d1";

function setup() {
  const db = new SqliteD1();
  db.database.exec(`
    INSERT INTO users (id, auth_subject, account, normalized_account) VALUES
      ('user-a', 'subject-a', 'user-a', 'user-a'),
      ('user-b', 'subject-b', 'user-b', 'user-b')
  `);
  return db;
}

test("个人备注按账号和标准化比赛 ID 隔离，缺失记录返回空值", async () => {
  const db = setup();
  const d1 = db.asD1();
  const saved = await updateUserMatchNote(d1, "user-a", "sporttery-2041458", {
    note: "  只属于 A\n的备注  ",
    expectedRevision: 0,
  }, new Date("2026-10-15T01:00:00.000Z"));

  assert.deepEqual(saved, {
    matchId: "2041458",
    note: "只属于 A\n的备注",
    revision: 1,
    updatedAt: "2026-10-15T01:00:00.000Z",
  });
  assert.deepEqual((await getUserMatchNotes(d1, "user-a", ["2041458", "missing"])).notes, [
    saved,
    { matchId: "missing", note: "", revision: 0, updatedAt: "" },
  ]);
  assert.deepEqual((await getUserMatchNotes(d1, "user-b", ["2041458"])).notes, [
    { matchId: "2041458", note: "", revision: 0, updatedAt: "" },
  ]);
});

test("个人备注使用 revision 原子更新，冲突和清空不会回退版本", async () => {
  const db = setup();
  const d1 = db.asD1();
  const created = await updateUserMatchNote(d1, "user-a", "2041458", { note: "第一版", expectedRevision: 0 });
  const updated = await updateUserMatchNote(d1, "user-a", "2041458", { note: "第二版", expectedRevision: created.revision });
  assert.equal(updated.revision, 2);
  assert.equal(updated.note, "第二版");

  await assert.rejects(
    updateUserMatchNote(d1, "user-a", "2041458", { note: "陈旧覆盖", expectedRevision: 1 }),
    (error: Error & { status?: number; revision?: number }) => error.status === 409 && error.revision === 2,
  );
  const cleared = await updateUserMatchNote(d1, "user-a", "2041458", { note: "   ", expectedRevision: 2 });
  assert.equal(cleared.note, "");
  assert.equal(cleared.revision, 3);
  await assert.rejects(
    updateUserMatchNote(d1, "user-a", "never-created", { note: "错误创建", expectedRevision: 3 }),
    (error: Error & { status?: number; revision?: number }) => error.status === 409 && error.revision === 0,
  );

  const competingCreates = await Promise.allSettled([
    updateUserMatchNote(d1, "user-a", "first-write-race", { note: "A", expectedRevision: 0 }),
    updateUserMatchNote(d1, "user-a", "first-write-race", { note: "B", expectedRevision: 0 }),
  ]);
  assert.equal(competingCreates.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(competingCreates.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    (competingCreates.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.status,
    409,
  );
});

test("较旧的批量读取结果不会覆盖已保存的新 revision", () => {
  const current = {
    "2041458": { matchId: "2041458", note: "刚保存", revision: 2, updatedAt: "2026-10-15T02:00:00.000Z" },
  };
  assert.strictEqual(mergePersonalMatchNote(current, {
    matchId: "2041458",
    note: "较旧读取",
    revision: 1,
    updatedAt: "2026-10-15T01:00:00.000Z",
  }), current);
});

test("个人备注拒绝无效 ID、字段、版本、长度和空批量查询", async () => {
  const d1 = setup().asD1();
  assert.throws(() => parsePersonalMatchNoteIds([]), /1 至 100/);
  assert.throws(() => parsePersonalMatchNoteIds(["bad\nvalue"]), /ID 无效/);
  await assert.rejects(updateUserMatchNote(d1, "user-a", "2041458", {
    note: "值",
    expectedRevision: 0,
    userId: "user-b",
  }), /不支持的字段/);
  await assert.rejects(updateUserMatchNote(d1, "user-a", "2041458", { note: "值", expectedRevision: -1 }), /版本号无效/);
  await assert.rejects(updateUserMatchNote(d1, "user-a", "2041458", { note: "字".repeat(2001), expectedRevision: 0 }), /2000 字/);
});

test("删除共享比赛不会删除仍供历史订单使用的个人备注", async () => {
  const db = setup();
  const d1 = db.asD1();
  db.database.exec(`INSERT INTO shared_matches (match_id, business_date, data_json) VALUES ('2041458', '2026-10-15', '{}')`);
  await updateUserMatchNote(d1, "user-a", "2041458", { note: "历史备注", expectedRevision: 0 });
  db.database.exec("DELETE FROM shared_matches WHERE match_id = '2041458'");
  assert.equal((await getUserMatchNotes(d1, "user-a", ["2041458"])).notes[0].note, "历史备注");
});
