import assert from "node:assert/strict";
import test from "node:test";
import {
  createTeamTagShare,
  createUserTeamTag,
  deleteUserTeamTag,
  importTeamTagShare,
  listUserTeamTags,
  updateUserTeamTag,
  updateUserTeamTagMemberNote,
} from "../app/server/team-tags-service";
import { SqliteD1 } from "./helpers/sqlite-d1";

function setup() {
  const db = new SqliteD1();
  db.database.exec(`
    INSERT INTO users (id, auth_subject, account, normalized_account) VALUES
      ('user-a','subject-a','user-a','user-a'),('user-b','subject-b','user-b','user-b');
    INSERT INTO shared_team_name_groups (id, revision, updated_at, display_order) VALUES ('group-a',0,'2026-10-19T00:00:00Z',0);
    INSERT INTO shared_team_names (id,group_id,name,name_key,active_slot,updated_at) VALUES
      ('name-a','group-a','A队','a队',1,'2026-10-19T00:00:00Z'),
      ('name-b','group-a','B队','b队',2,'2026-10-19T00:00:00Z');
  `);
  return db;
}

const draft = {
  name: "26 欧冠", shortText: "欧", color: "#1677ff", dateBasis: "current" as const, startDate: null, endDate: null,
  members: [{ sourceName: "A队", note: "重点观察" }],
};

test("个人标签按账号隔离并使用 revision 更新备注", async () => {
  const db = setup();
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft)).tag;
  assert.equal((await listUserTeamTags(db.asD1(), "user-b")).tags.length, 0);
  const saved = await updateUserTeamTagMemberNote(db.asD1(), "user-a", created.id, created.members[0].id, {
    note: "新备注", expectedRevision: 0,
  }, new Date("2026-10-19T01:00:00Z"));
  assert.equal(saved.member.note, "新备注");
  assert.equal(saved.member.revision, 1);
  assert.equal(saved.tag.revision, 1);
  await assert.rejects(
    updateUserTeamTagMemberNote(db.asD1(), "user-b", created.id, created.members[0].id, { note: "越权", expectedRevision: 1 }),
    (error: Error & { status?: number }) => error.status === 404,
  );
});

test("配置时会按公共别称拒绝同标签重复球队", async () => {
  const db = setup();
  await assert.rejects(createUserTeamTag(db.asD1(), "user-a", {
    ...draft,
    members: [{ sourceName: "A队", note: "A" }, { sourceName: "B队", note: "B" }],
  }), /属于同一球队/);
});

test("后续别称合并的历史成员仍可整体保存", async () => {
  const db = setup();
  db.database.exec("DELETE FROM shared_team_names WHERE id='name-b'");
  const created = (await createUserTeamTag(db.asD1(), "user-a", {
    ...draft, members: [{ sourceName: "A队", note: "A" }, { sourceName: "B队", note: "B" }],
  })).tag;
  db.database.exec(`INSERT INTO shared_team_names (id,group_id,name,name_key,active_slot,updated_at) VALUES ('name-b2','group-a','B队','b队',2,'2026-10-19T01:00:00Z')`);
  const updated = (await updateUserTeamTag(db.asD1(), "user-a", created.id, {
    name: created.name,
    shortText: created.shortText,
    color: created.color,
    dateBasis: created.dateBasis,
    startDate: created.startDate,
    endDate: created.endDate,
    expectedRevision: created.revision,
    members: created.members.map(({ id, sourceName, teamGroupId, note, revision }) => ({ id, sourceName, teamGroupId, note, revision })),
  })).tag;
  assert.equal(updated.members.length, 2);
  await assert.rejects(updateUserTeamTag(db.asD1(), "user-a", created.id, {
    name: updated.name,
    shortText: updated.shortText,
    color: updated.color,
    dateBasis: updated.dateBasis,
    startDate: updated.startDate,
    endDate: updated.endDate,
    expectedRevision: updated.revision,
    members: updated.members.map((member, index) => ({
      id: member.id,
      sourceName: index === 0 ? "B队" : member.sourceName,
      teamGroupId: member.teamGroupId,
      note: member.note,
      revision: member.revision,
    })),
  }), /球队重复/);
});

test("删除标签校验账号和 revision 并级联删除成员", async () => {
  const db = setup();
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft)).tag;
  await assert.rejects(
    deleteUserTeamTag(db.asD1(), "user-b", created.id, created.revision),
    (error: Error & { status?: number }) => error.status === 404,
  );
  await assert.rejects(deleteUserTeamTag(db.asD1(), "user-a", created.id, created.revision + 1), /已在其他位置更新/);
  await deleteUserTeamTag(db.asD1(), "user-a", created.id, created.revision);
  assert.equal((await listUserTeamTags(db.asD1(), "user-a")).tags.length, 0);
  assert.equal(db.database.prepare("SELECT COUNT(*) AS count FROM user_team_tag_members WHERE tag_id=?").get(created.id)?.count, 0);
});

test("整标签保存遇到并发更新时不删除或覆盖新成员", async () => {
  const db = setup();
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft)).tag;
  db.beforeBatch = () => {
    db.beforeBatch = undefined;
    db.database.prepare("UPDATE user_team_tags SET name=?,revision=revision+1 WHERE id=?").run("并发标签", created.id);
  };
  await assert.rejects(updateUserTeamTag(db.asD1(), "user-a", created.id, {
    name: "旧草稿",
    shortText: created.shortText,
    color: created.color,
    dateBasis: created.dateBasis,
    startDate: created.startDate,
    endDate: created.endDate,
    expectedRevision: created.revision,
    members: created.members.map(({ id, sourceName, teamGroupId, note, revision }) => ({ id, sourceName, teamGroupId, note, revision })),
  }), /已在其他位置更新/);
  const tagRow = db.database.prepare("SELECT name,revision FROM user_team_tags WHERE id=?").get(created.id);
  const memberRow = db.database.prepare("SELECT note FROM user_team_tag_members WHERE id=?").get(created.members[0].id);
  assert.equal(tagRow?.name, "并发标签");
  assert.equal(tagRow?.revision, 1);
  assert.equal(memberRow?.note, "重点观察");
});

test("备注旧版本并发失败不会额外递增标签版本", async () => {
  const db = setup();
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft)).tag;
  db.beforeBatch = () => {
    db.beforeBatch = undefined;
    db.database.prepare("UPDATE user_team_tag_members SET note=?,revision=revision+1,mutation_token=? WHERE id=?")
      .run("并发备注", "concurrent", created.members[0].id);
    db.database.prepare("UPDATE user_team_tags SET revision=revision+1 WHERE id=?").run(created.id);
  };
  await assert.rejects(
    updateUserTeamTagMemberNote(db.asD1(), "user-a", created.id, created.members[0].id, { note: "旧备注", expectedRevision: 0 }),
    /已在其他位置更新/,
  );
  const tagRow = db.database.prepare("SELECT revision FROM user_team_tags WHERE id=?").get(created.id);
  const memberRow = db.database.prepare("SELECT note,revision FROM user_team_tag_members WHERE id=?").get(created.members[0].id);
  assert.equal(tagRow?.revision, 1);
  assert.equal(memberRow?.note, "并发备注");
  assert.equal(memberRow?.revision, 1);
});

test("24 小时分享快照可供多个账号导入且同码幂等", async () => {
  const db = setup();
  const now = new Date("2026-10-19T00:00:00Z");
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft, now)).tag;
  const share = await createTeamTagShare(db.asD1(), "user-a", created.id, { expectedRevision: created.revision }, now);
  assert.equal(share.expiresAt, "2026-10-20T00:00:00.000Z");
  const first = await importTeamTagShare(db.asD1(), "user-b", { code: share.code, requestId: "request-1" }, new Date("2026-10-19T12:00:00Z"));
  const repeated = await importTeamTagShare(db.asD1(), "user-b", { code: share.code, requestId: "request-2" }, new Date("2026-10-19T13:00:00Z"));
  assert.equal(first.imported, true);
  assert.equal(repeated.imported, false);
  assert.equal(repeated.tag.id, first.tag.id);
  assert.equal(repeated.tag.members[0].note, "重点观察");
  await assert.rejects(
    importTeamTagShare(db.asD1(), "user-a", { code: share.code, requestId: "expired" }, new Date("2026-10-20T00:00:00Z")),
    /已过期/,
  );
});

test("已删除的导入副本可以用同一有效分享码重新导入", async () => {
  const db = setup();
  const now = new Date("2026-10-19T00:00:00Z");
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft, now)).tag;
  const share = await createTeamTagShare(db.asD1(), "user-a", created.id, { expectedRevision: created.revision }, now);
  const first = await importTeamTagShare(db.asD1(), "user-b", { code: share.code, requestId: "first-copy" }, new Date("2026-10-19T01:00:00Z"));
  await deleteUserTeamTag(db.asD1(), "user-b", first.tag.id, first.tag.revision);
  const second = await importTeamTagShare(db.asD1(), "user-b", { code: share.code, requestId: "second-copy" }, new Date("2026-10-19T02:00:00Z"));
  assert.equal(second.imported, true);
  assert.notEqual(second.tag.id, first.tag.id);
  assert.equal((await listUserTeamTags(db.asD1(), "user-b")).tags.length, 1);
});

test("分享码导入尝试按账号和分钟限流", async () => {
  const db = setup();
  const now = new Date("2026-10-19T00:00:30Z");
  for (let index = 0; index < 20; index += 1) {
    await assert.rejects(
      importTeamTagShare(db.asD1(), "user-a", { code: `ST-${String(index).padStart(48, "0")}`, requestId: `attempt-${index}` }, now),
      /不存在或已过期/,
    );
  }
  await assert.rejects(
    importTeamTagShare(db.asD1(), "user-a", { code: `ST-${"F".repeat(48)}`, requestId: "blocked" }, now),
    (error: Error & { status?: number }) => error.status === 429,
  );
  await assert.rejects(
    importTeamTagShare(db.asD1(), "user-b", { code: `ST-${"E".repeat(48)}`, requestId: "other-user" }, now),
    /不存在或已过期/,
  );
});

test("分享码在导入事务前到期时不产生半份标签", async () => {
  const db = setup();
  const created = (await createUserTeamTag(db.asD1(), "user-a", draft)).tag;
  const now = new Date("2026-10-19T00:00:00Z");
  const share = await createTeamTagShare(db.asD1(), "user-a", created.id, { expectedRevision: created.revision }, now);
  db.beforeBatch = () => {
    db.beforeBatch = undefined;
    db.database.prepare("UPDATE team_tag_shares SET expires_at=?").run(now.toISOString());
  };
  await assert.rejects(
    importTeamTagShare(db.asD1(), "user-b", { code: share.code, requestId: "expires-during-import" }, new Date("2026-10-19T12:00:00Z")),
    /不存在或已过期/,
  );
  assert.equal((await listUserTeamTags(db.asD1(), "user-b")).tags.length, 0);
});
