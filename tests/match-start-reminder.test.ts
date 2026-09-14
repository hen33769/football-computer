import assert from "node:assert/strict";
import test from "node:test";
import {
  collectMatchStartReminders,
  isMatchStartingSoon,
  MATCH_START_REMINDER_WINDOW_MS,
  parseMatchStartReminderRecord,
} from "../app/match-start-reminder";
import { getMatchKickoffAt } from "../app/sporttery";
import type { MatchItem } from "../app/types";

const match = (id: string, time: string, code = id): MatchItem => ({
  id,
  date: "2026-09-14",
  weekday: "周一",
  code,
  league: "测试联赛",
  time,
  home: `主队${id}`,
  away: `客队${id}`,
  markets: [],
});

test("统一解析完整开赛时间和仅含时分秒的历史时间", () => {
  assert.equal(
    getMatchKickoffAt(match("1", "2026-09-15 01:05")),
    new Date("2026-09-15T01:05:00").getTime(),
  );
  assert.equal(
    getMatchKickoffAt(match("2", "1:05:30")),
    new Date("2026-09-14T01:05:30").getTime(),
  );
  assert.equal(getMatchKickoffAt(match("3", "不是时间")), null);
  assert.equal(getMatchKickoffAt(match("4", "")), null);
});

test("准备开赛窗口包含恰好 30 分钟但不包含开赛时刻", () => {
  const now = new Date("2026-09-14T12:00:00");
  assert.equal(isMatchStartingSoon(match("1", "2026-09-14 12:30"), now), true);
  assert.equal(isMatchStartingSoon(match("2", "2026-09-14 12:30:01"), now), false);
  assert.equal(isMatchStartingSoon(match("3", "2026-09-14 12:00"), now), false);
  assert.equal(isMatchStartingSoon(match("4", "2026-09-14 11:59"), now), false);
  assert.equal(MATCH_START_REMINDER_WINDOW_MS, 30 * 60 * 1000);
});

test("提醒记录标准化 ID 并清理过期、无效和损坏数据", () => {
  const now = new Date("2026-09-14T12:00:00");
  const future = new Date("2026-09-14T12:20:00").getTime();
  const later = new Date("2026-09-14T12:25:00").getTime();
  assert.deepEqual(parseMatchStartReminderRecord(JSON.stringify({
    "sporttery-100": future,
    "100": later,
    expired: now.getTime(),
    stringValue: String(later),
    infinite: null,
  }), now), { "100": later });
  assert.deepEqual(parseMatchStartReminderRecord("{broken", now), {});
  assert.deepEqual(parseMatchStartReminderRecord(JSON.stringify([future]), now), {});
});

test("筛选全部公共比赛、按开赛时间排序并对标准化比赛 ID 去重", () => {
  const now = new Date("2026-09-14T12:00:00");
  const remindedKickoff = new Date("2026-09-14T12:15:00").getTime();
  const { reminders, nextRecord } = collectMatchStartReminders([
    match("sporttery-200", "2026-09-14 12:20", "200"),
    match("100", "2026-09-14 12:10", "100"),
    match("sporttery-100", "2026-09-14 12:12", "100"),
    match("300", "2026-09-14 12:30", "300"),
    match("400", "2026-09-14 12:31", "400"),
    match("500", "2026-09-14 11:59", "500"),
    match("invalid", "无效", "600"),
  ], { "100": remindedKickoff }, now);

  assert.deepEqual(reminders.map((item) => item.match.id), ["sporttery-200", "300"]);
  assert.deepEqual(reminders.map((item) => item.minutesUntil), [20, 30]);
  assert.deepEqual(nextRecord, {
    "100": remindedKickoff,
    "200": new Date("2026-09-14T12:20:00").getTime(),
    "300": new Date("2026-09-14T12:30:00").getTime(),
  });
});

test("原提醒时间过期后，延期比赛可在新窗口再次提醒", () => {
  const originalKickoff = new Date("2026-09-14T12:00:00").getTime();
  const now = new Date("2026-09-14T12:05:00");
  const reminded = parseMatchStartReminderRecord(JSON.stringify({ "700": originalKickoff }), now);
  const { reminders, nextRecord } = collectMatchStartReminders([
    match("700", "2026-09-14 12:25", "700"),
  ], reminded, now);

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].match.id, "700");
  assert.equal(reminders[0].minutesUntil, 20);
  assert.equal(nextRecord["700"], new Date("2026-09-14T12:25:00").getTime());
});
