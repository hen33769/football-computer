import { createEmptyMatch } from "./data";
import type { MatchItem, MarketType } from "./types";

export async function recognizeImage(file: File, onProgress: (value: number, status: string) => void): Promise<string> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const isStandaloneFile = typeof window !== "undefined" && window.location.protocol === "file:";
  const worker = await createWorker(["chi_sim", "eng"], OEM.LSTM_ONLY, {
    ...(isStandaloneFile ? {} : {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/tessdata",
    }),
    gzip: true,
    logger: (message) => {
      const progress = typeof message.progress === "number" ? message.progress : 0;
      onProgress(progress, String(message.status ?? "正在识别"));
    },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const result = await worker.recognize(file);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

const weekdayMap: Record<string, string> = {
  一: "周一", 二: "周二", 三: "周三", 四: "周四", 五: "周五", 六: "周六", 日: "周日", 天: "周日",
};

export function parseRecognizedText(rawText: string, options: { selectOptions?: boolean; emptyOdds?: boolean } = {}): MatchItem[] {
  const selectOptions = options.selectOptions ?? true;
  const lines = rawText
    .replace(/[：]/g, ":")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const matches: MatchItem[] = [];
  let current: MatchItem | null = null;
  let currentMarket: MarketType = "spf";
  let pendingMeta: { id?: string; date?: string; league?: string; time?: string } = {};

  lines.forEach((line) => {
    const standaloneId = line.match(/^比赛\s*ID\s*[:：]?\s*(\d{7})$/i);
    if (standaloneId) {
      pendingMeta = { id: standaloneId[1] };
      current = null;
      return;
    }
    const dateMeta = line.match(/^比赛日期\s*[:：]\s*(\d{4}-\d{2}-\d{2})$/);
    if (dateMeta) {
      if (current) current.date = dateMeta[1];
      else pendingMeta.date = dateMeta[1];
      return;
    }
    const leagueMeta = line.match(/^联赛\s*[:：]\s*(.+)$/);
    if (leagueMeta) {
      if (current) current.league = leagueMeta[1].trim();
      else pendingMeta.league = leagueMeta[1].trim();
      return;
    }
    const timeMeta = line.match(/^开赛时间\s*[:：]\s*(.+)$/);
    if (timeMeta) {
      if (current) current.time = timeMeta[1].trim();
      else pendingMeta.time = timeMeta[1].trim();
      return;
    }

    const header = line.match(/(?:周([一二三四五六日天]))?\s*(\d{3})\s+([^\s]{2,18})\s*(?:VS|Vs|vs|V5|∨S)\s*([^\s]{2,18})/i);
    if (header) {
      const fresh = createEmptyMatch(matches.length, options.emptyOdds ?? false);
      const inlineId = line.match(/(?:比赛\s*)?ID\s*[:：]?\s*(\d{7})/i)?.[1];
      fresh.id = inlineId ?? pendingMeta.id ?? `ocr-${Date.now()}-${matches.length}`;
      if (pendingMeta.date) fresh.date = pendingMeta.date;
      if (pendingMeta.league) fresh.league = pendingMeta.league;
      if (pendingMeta.time) fresh.time = pendingMeta.time;
      fresh.weekday = header[1] ? weekdayMap[header[1]] : fresh.weekday;
      fresh.code = header[2];
      fresh.home = header[3].replace(/[★☆]/g, "");
      fresh.away = header[4].replace(/[★☆]/g, "");
      const league = line.match(/\b(韩职|日职|欧冠|英超|西甲|德甲|意甲|法甲|瑞超|挪超|美职足)\b/);
      if (league) fresh.league = league[1];
      current = fresh;
      matches.push(fresh);
      pendingMeta = {};
    }
    if (!current) return;

    if (/半全场/.test(line)) currentMarket = "halfFull";
    else if (/让球|\([+-]\d+\)/.test(line)) currentMarket = "rqspf";
    else if (/胜平负/.test(line)) currentMarket = "spf";
    else if (/比分/.test(line)) currentMarket = "score";
    else if (/总进球/.test(line)) currentMarket = "goals";

    const handicap = line.match(/\(([+-]\d+)\)/);
    if (handicap) {
      const rqspf = current.markets.find((market) => market.type === "rqspf");
      if (rqspf) rqspf.handicap = Number(handicap[1]);
    }

    const market = current.markets.find((item) => item.type === currentMarket);
    if (!market) return;
    const optionRegex = /(主胜|主负|胜其他|平其他|负其他|胜胜|胜平|胜负|平胜|平平|平负|负胜|负平|负负|\d+:\d+|7\+|[0-6]|平|胜|负)\s*@?\s*([0-9]+(?:\.[0-9]+)?)/g;
    let found = optionRegex.exec(line);
    while (found) {
      const label = found[1];
      const normalized = label === "胜" ? "主胜" : label === "负" ? "主负" : label;
      const target = market.options.find((item) => item.label === normalized || item.id === normalized);
      if (target) {
        target.odds = Number(found[2]);
        target.selected = selectOptions;
      }
      found = optionRegex.exec(line);
    }

    if (selectOptions) {
      const optionSegment = line
        .replace(/让球胜平负|胜平负|比分|总进球数?|半全场胜平负/g, " ")
        .replace(/\([+-]\d+\)/g, " ");
      market.options.forEach((item) => {
        const escaped = item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const token = new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`);
        if (token.test(optionSegment)) item.selected = true;
      });
    }
  });

  return matches;
}
