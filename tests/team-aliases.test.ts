import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamNameIndex, normalizeTeamName, resolveTeamIcon, resolveTeamNameDisplay, type TeamNameGroup } from "../app/team-aliases";
import { validateTeamNameGroupPayload } from "../app/server/team-aliases-service";

const group: TeamNameGroup = {
  id: "djurgardens",
  iconDataUrl: "data:image/png;base64,AAAA",
  revision: 0,
  updatedAt: "2026-09-01T00:00:00.000Z",
  names: [
    { id: "name-1", groupId: "djurgardens", name: "尤加尔登", nameKey: "尤加尔登", activeSlot: 1 },
    { id: "name-2", groupId: "djurgardens", name: "佐加顿斯", nameKey: "佐加顿斯", activeSlot: 2 },
    { id: "name-3", groupId: "djurgardens", name: "Djurgardens", nameKey: "djurgardens", activeSlot: null },
  ],
};

test("队伍名称匹配会忽略空白、大小写和全角差异", () => {
  assert.equal(normalizeTeamName(" Ｄｊｕｒｇａｒｄｅｎｓ "), "djurgardens");
  assert.equal(normalizeTeamName("佐 加顿斯"), "佐加顿斯");
});

test("接口名称是第一个激活名时，第二个激活名显示在前面", () => {
  const display = resolveTeamNameDisplay("尤加尔登", buildTeamNameIndex([group]));
  assert.deepEqual(display, { normalName: "尤加尔登", aliasName: "佐加顿斯", aliasBefore: true });
});

test("接口名称是第二个激活名时，第一个激活名显示在后面", () => {
  const display = resolveTeamNameDisplay("佐加顿斯", buildTeamNameIndex([group]));
  assert.deepEqual(display, { normalName: "尤加尔登", aliasName: "佐加顿斯", aliasBefore: false });
});

test("接口名称是未激活名称时，首个激活名显示为副名", () => {
  const display = resolveTeamNameDisplay("Djurgardens", buildTeamNameIndex([group]));
  assert.deepEqual(display, { normalName: "Djurgardens", aliasName: "尤加尔登", aliasBefore: true });
});

test("没有匹配队伍配置时不显示别名，未完整激活时也不生效", () => {
  assert.deepEqual(resolveTeamNameDisplay("未知队伍", buildTeamNameIndex([group])), {
    normalName: "未知队伍",
    aliasName: null,
    aliasBefore: false,
  });
  const incomplete = { ...group, names: group.names.map((entry) => ({ ...entry, activeSlot: entry.activeSlot === 2 ? null : entry.activeSlot })) };
  assert.equal(resolveTeamNameDisplay("尤加尔登", buildTeamNameIndex([incomplete])).aliasName, null);
});

test("队伍名称的历史名称会解析到名称组图标", () => {
  const index = buildTeamNameIndex([group]);
  assert.equal(resolveTeamIcon("Djurgardens", index), "data:image/png;base64,AAAA");
  assert.equal(resolveTeamIcon("未知队伍", index), null);
});

test("保存校验拒绝重复名称和非两个激活位", () => {
  assert.throws(
    () => validateTeamNameGroupPayload({ names: [{ name: "队伍", activeSlot: 1 }, { name: " 队伍 ", activeSlot: 2 }] }),
    (error: unknown) => error instanceof Error && error.message.includes("队伍名称重复"),
  );
  assert.throws(
    () => validateTeamNameGroupPayload({ names: [{ name: "队伍 A", activeSlot: 1 }, { name: "队伍 B", activeSlot: null }] }),
    (error: unknown) => error instanceof Error && error.message.includes("恰好激活两个名称"),
  );
});

test("保存校验只接受安全的队伍图标 data URL", () => {
  assert.equal(validateTeamNameGroupPayload({
    iconDataUrl: "data:image/webp;base64,AAAA",
    names: [{ name: "队伍 A", activeSlot: 1 }, { name: "队伍 B", activeSlot: 2 }],
  }).iconDataUrl, "data:image/webp;base64,AAAA");
  assert.throws(
    () => validateTeamNameGroupPayload({
      iconDataUrl: "data:image/svg+xml;base64,AAAA",
      names: [{ name: "队伍 A", activeSlot: 1 }, { name: "队伍 B", activeSlot: 2 }],
    }),
    (error: unknown) => error instanceof Error && error.message.includes("PNG、JPG 或 WebP"),
  );
});
