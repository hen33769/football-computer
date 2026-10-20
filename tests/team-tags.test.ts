import assert from "node:assert/strict";
import test from "node:test";
import {
  firstVisibleCharacter,
  isTeamTagActive,
  resolveTeamTags,
  teamTagLabel,
  type TeamTag,
} from "../app/team-tags";
import { buildTeamNameIndex, type TeamNameGroup } from "../app/team-aliases";
import type { MatchItem } from "../app/types";

const groups: TeamNameGroup[] = [{
  id: "team-a",
  iconDataUrl: null,
  revision: 0,
  updatedAt: "2026-10-19T00:00:00.000Z",
  names: [
    { id: "a", groupId: "team-a", name: "A队", nameKey: "a队", activeSlot: 1 },
    { id: "b", groupId: "team-a", name: "B队", nameKey: "b队", activeSlot: 2 },
  ],
}];
const match: MatchItem = { id: "m", date: "2026-10-19", weekday: "周一", code: "001", league: "测试", time: "2026-10-19 19:00", home: "A队", away: "C队", markets: [] };
const tag: TeamTag = {
  id: "tag", name: "26 欧冠", shortText: "", color: "#1677ff", dateBasis: "current", startDate: "2026-10-19", endDate: "2026-10-19",
  displayOrder: 0, revision: 0, updatedAt: "", members: [
    { id: "ma", tagId: "tag", sourceName: "A队", sourceNameKey: "a队", teamGroupId: "team-a", note: "A 备注", displayOrder: 0, revision: 0, updatedAt: "" },
    { id: "mb", tagId: "tag", sourceName: "B队", sourceNameKey: "b队", teamGroupId: "team-a", note: "B 备注", displayOrder: 1, revision: 0, updatedAt: "" },
  ],
};

test("标签短文案支持 emoji 首个可见字符", () => {
  assert.equal(firstVisibleCharacter(" 🏆 冠军"), "🏆");
  assert.equal(teamTagLabel(tag), "2");
  assert.equal(teamTagLabel({ name: "26 欧冠", shortText: "欧" }), "欧");
});

test("标签日期按当前日期或比赛日期包含边界", () => {
  assert.equal(isTeamTagActive(tag, match, new Date("2026-10-18T16:00:00.000Z")), true);
  assert.equal(isTeamTagActive(tag, match, new Date("2026-10-19T16:00:00.000Z")), false);
  assert.equal(isTeamTagActive({ ...tag, dateBasis: "match" }, match, new Date("2030-01-01T00:00:00Z")), true);
});

test("别称后来合并时同一标签只解析一次并保留多份备注", () => {
  const resolved = resolveTeamTags([tag], "B队", match, new Date("2026-10-19T04:00:00Z"), buildTeamNameIndex(groups), groups);
  assert.equal(resolved.length, 1);
  assert.deepEqual(resolved[0].members.map((member) => member.note), ["A 备注", "B 备注"]);
});
