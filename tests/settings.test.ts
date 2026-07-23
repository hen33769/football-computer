import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultSettings,
  getLeagueTagColor,
  normalizeAppSettings,
  readableTagTextColor,
  withLeagueTagColor,
} from "../app/settings";

test("默认联赛颜色与接口简称别名保持一致", () => {
  const settings = createDefaultSettings();
  assert.equal(getLeagueTagColor(settings, "欧冠"), "#faad14");
  assert.equal(getLeagueTagColor(settings, "美职"), "#660033");
});

test("联赛颜色更新使用可扩展的 appearance 设置结构", () => {
  const settings = withLeagueTagColor(createDefaultSettings(), "美职", "#123456");
  assert.equal(settings.appearance.leagueTagColors.美职联, "#123456");
  assert.equal(getLeagueTagColor(settings, "美职"), "#123456");
});

test("导入设置会过滤非法颜色并补齐默认配置", () => {
  const settings = normalizeAppSettings({ appearance: { leagueTagColors: { 欧冠: "#ABC", 巴甲: "red", 新联赛: "#112233" } } });
  assert.equal(settings.appearance.leagueTagColors.欧冠, "#abc");
  assert.equal(settings.appearance.leagueTagColors.巴甲, "#d5ec76");
  assert.equal(settings.appearance.leagueTagColors.新联赛, "#112233");
});

test("浅色与深色标签会得到可读文字颜色", () => {
  assert.equal(readableTagTextColor("#d5ec76"), "#26383d");
  assert.equal(readableTagTextColor("#660033"), "#ffffff");
});
