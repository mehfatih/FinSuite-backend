// ================================================================
// Sprint D-7 — OG image renderer for public share pages.
//
// Decision §6.D option D1: reuses the D-2.5 Puppeteer pool from
// services/pdf/pdfRenderer.ts. Same browsers, same launch args,
// same hardening (Chromium libs in nixpacks.toml, t64-suffix audit,
// multi-process flag). Just calls page.screenshot() instead of
// page.pdf().
//
// Output: 1200x630 PNG buffer (standard Open Graph image size).
// Caller serves it with Cache-Control: public, max-age=86400 so
// each unique slug renders once and CDN/browser/crawler caches it.
//
// Zero new deps; zero new infrastructure.
// ================================================================
import { acquireBrowser, release, PooledBrowser } from "../pdf/pdfRenderer";

const PAGE_TIMEOUT_MS = 12_000;
const OG_WIDTH  = 1200;
const OG_HEIGHT = 630;

export interface RenderOgImageArgs {
  html: string;
}

export async function renderOgImage(args: RenderOgImageArgs): Promise<Buffer> {
  const slot: PooledBrowser = await acquireBrowser();
  let page;
  try {
    page = await slot.browser.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    // Force the viewport to OG dimensions so the screenshot crops
    // exactly to the Open Graph standard (1200x630, deviceScaleFactor
    // 1 → 1x output; bumping to 2 doubles file size for marginally
    // sharper preview, deferred to V2 if needed).
    await page.setViewport({ width: OG_WIDTH, height: OG_HEIGHT, deviceScaleFactor: 1 });

    await page.setContent(args.html, { waitUntil: "networkidle0", timeout: PAGE_TIMEOUT_MS });

    const png = await page.screenshot({
      type:        "png",
      omitBackground: false,
      clip:        { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT }
    });
    return Buffer.from(png as Uint8Array);
  } finally {
    if (page) await page.close().catch(() => undefined);
    release(slot);
  }
}
