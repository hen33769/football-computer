import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(projectRoot, "dist");
const htmlPath = join(distDir, "standalone", "index.html");
const fallbackHtmlPath = join(distDir, "index.html");

let sourcePath = htmlPath;
let html;
try {
  html = await readFile(sourcePath, "utf8");
} catch {
  sourcePath = fallbackHtmlPath;
  html = await readFile(sourcePath, "utf8");
}

const assetFiles = await readdir(join(distDir, "assets"));
const cssFile = assetFiles.find((name) => name.endsWith(".css"));
const jsFile = assetFiles.find((name) => name.endsWith(".js"));

if (!cssFile || !jsFile) {
  throw new Error("未找到待内联的 CSS 或 JavaScript 构建文件");
}

const css = (await readFile(join(distDir, "assets", cssFile), "utf8")).replaceAll("</style", "<\\/style");
const js = (await readFile(join(distDir, "assets", jsFile), "utf8")).replaceAll("</script", "<\\/script");

const stylePlaceholder = "<!-- INLINE_STYLES -->";
const scriptPlaceholder = "<!-- INLINE_SCRIPT -->";

html = html
  .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/g, stylePlaceholder)
  .replace(/<script[^>]+src=["'][^"']+\.js["'][^>]*><\/script>/g, "")
  .replace("</body>", `${scriptPlaceholder}</body>`)
  .replace(/<link[^>]+rel=["']modulepreload["'][^>]*>/g, "");

if (/<(?:script|link)\b[^>]+(?:src|href)=["'][^"']+\.(?:js|css)["'][^>]*>/i.test(html)) {
  throw new Error("HTML 中仍存在外部 JavaScript 或 CSS 引用");
}

html = html
  .replace(stylePlaceholder, () => `<style>${css}</style>`)
  .replace(scriptPlaceholder, () => `<script>${js}</script>`);

const outputPath = join(distDir, "football-simulator.html");
await writeFile(outputPath, html, "utf8");
await rm(join(distDir, "assets"), { recursive: true, force: true });
if (sourcePath !== outputPath) await rm(sourcePath, { force: true });
await rm(join(distDir, "standalone"), { recursive: true, force: true });

const sizeMb = Buffer.byteLength(html) / 1024 / 1024;
console.log(`已生成 ${outputPath} (${sizeMb.toFixed(2)} MB)`);
