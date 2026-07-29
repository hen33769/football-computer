import { getPassLimit, selectedMatches } from "./calculator";
import type { MatchItem } from "./types";

const PASS_NUMBERS: Record<string, number> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
};

const PASS_TOKEN_PATTERN = /(单场|单关)|([1-8一二三四五六七八])\s*(?:串|[xX×])\s*(?:1|一)|([1-8一二三四五六七八])\s*关/g;
const ADJACENT_NUMBER_PATTERN = /[0-9〇零一二三四五六七八九十百千万]/;
const PASS_LIST_SEPARATOR_PATTERN = /[、,，;；/|]+/;

export function formatOrderPassValue(value: number) {
  return value === 1 ? "单场" : `${value}串1`;
}

export function parseOrderPassValues(text: string): number[] {
  const normalizedText = text.replace(/\s+/g, "");
  const standaloneValue = PASS_NUMBERS[normalizedText];
  if (standaloneValue) return [standaloneValue];

  const values: number[] = [];
  normalizedText.split(PASS_LIST_SEPARATOR_PATTERN).forEach((token) => {
    const value = PASS_NUMBERS[token];
    if (value) values.push(value);
  });

  for (const match of normalizedText.matchAll(PASS_TOKEN_PATTERN)) {
    if (match[1]) {
      values.push(1);
      continue;
    }

    const start = match.index;
    const end = start + match[0].length;
    const before = normalizedText[start - 1] ?? "";
    const after = normalizedText[end] ?? "";
    if (ADJACENT_NUMBER_PATTERN.test(before) || ADJACENT_NUMBER_PATTERN.test(after)) continue;

    const value = PASS_NUMBERS[match[2] ?? match[3]];
    if (value) values.push(value);
  }

  return [...new Set(values)].sort((left, right) => left - right);
}

export function appendOrderPassValue(text: string, value: number) {
  const values = [...parseOrderPassValues(text), value]
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 8);
  return [...new Set(values)]
    .sort((left, right) => left - right)
    .map(formatOrderPassValue)
    .join("、");
}

export function inferOrderPasses(text: string, orderMatches: MatchItem[]): number[] {
  const matchCount = selectedMatches(orderMatches).length;
  const limit = Math.min(matchCount, getPassLimit(orderMatches));
  if (limit <= 0) return [];

  const valid = parseOrderPassValues(text).filter((value) => value <= limit);
  return valid.length ? valid : [limit];
}
