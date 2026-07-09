const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8080/?page_id=89", { waitUntil: "load", timeout: 60000 }).catch((e) => console.warn("goto:", e.message));
  await page.waitForTimeout(1200);
  // Scroll through to trigger _interactions entrance animations, then back to top.
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) {
      const total = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      if (window.scrollY + window.innerHeight >= total - 2) break;
      window.scrollBy(0, window.innerHeight);
      await wait(120);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "storage/verify-page89-desktop.png" });
  await page.screenshot({ path: "storage/verify-page89-full.png", fullPage: true });
  const dims = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  console.log("page dims:", JSON.stringify(dims));
  await browser.close();
  console.log("done");
})();
