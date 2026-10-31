import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = async (file, type) =>
  `data:${type};base64,${(await readFile(resolve(root, "public", file))).toString("base64")}`;
const [font, body, hamster, icon] = await Promise.all([
  data("fonts/doto-latin-900.woff2", "font/woff2"),
  data("fonts/geist-latin-400.woff2", "font/woff2"),
  data("hamster.svg", "image/svg+xml"),
  data("favicon.svg", "image/svg+xml"),
]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>@font-face{font-family:Doto;src:url('${font}');font-weight:900}@font-face{font-family:Geist;src:url('${body}')}*{box-sizing:border-box}body{margin:0;background:#0e110f;color:#f0f1e8;font:28px/1.5 Geist}main{padding:56px 64px;height:630px;position:relative;border:16px solid #151b15}.brand{display:flex;align-items:center;gap:14px;font-size:22px}.brand img{width:32px;height:32px}h1{font:900 128px/1 Doto;letter-spacing:-.06em;margin:78px 0 24px}h1 span{color:#d9f865}p{margin:0;max-width:560px;color:#a5b29b}strong{color:#f0f1e8;font-weight:400}.art{position:absolute;right:26px;top:142px;width:440px;height:330px}.label{position:absolute;bottom:44px;font-size:20px;color:#a5b29b}.rule{position:absolute;left:64px;right:64px;bottom:90px;height:1px;background:#253125}</style><main><div class="brand"><img src="${icon}"/>HAMLOCK</div><h1>HAMLOCK</h1><p><strong>your bags. his legs.</strong><br/>lock eth. the hamster runs. you get it back. maybe.</p><img class="art" src="${hamster}"/><div class="rule"></div><div class="label">testnet toy. zero real value.</div></main>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(root, "public/og.png") });
  console.log("Generated public/og.png (1200 × 630) from local assets.");
} finally {
  await browser.close();
}
