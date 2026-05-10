// ================================================================
// pdfRenderer.ts — singleton browser pool + PDF rendering pipeline.
//
// Pool design (per Sprint D-2 user directive):
//   - Up to 2 long-lived Chromium instances reused across requests
//   - Each instance starts pre-warmed at first need
//   - Spawn the 2nd only when the 1st is busy and a 2nd request arrives
//   - Recycle a browser after MAX_RENDERS_PER_BROWSER renders to bound
//     memory drift from accumulated tabs/leaks
//   - Fallback (env): set PDF_MAX_BROWSERS=1 to force single-browser
//     queue mode if Railway memory pressure spikes
//
// Memory expectations (singleton, two browsers fully warm):
//   - Idle:  ~280-360 MB Chromium overhead (above Sprint D-2 §150 MB
//            idle target, but the user explicitly authorized 2 with a
//            single-browser fallback ready)
//   - Peak:  +50-100 MB during a single render
//   - Hard cap suggestion at 300 MB peak via PDF_MAX_BROWSERS=1
//
// Public API:
//   renderPdf({ html, format?, margin?, metadata? }) → Promise<Buffer>
//   shutdownRenderer() → Promise<void>   (graceful close on exit)
// ================================================================
import puppeteer, { Browser, PaperFormat } from 'puppeteer';
import { PDFDocument } from 'pdf-lib';

const POOL_SIZE = Math.max(1, Math.min(4, parseInt(process.env.PDF_MAX_BROWSERS || '2', 10) || 2));
const MAX_RENDERS_PER_BROWSER = 50;
const PAGE_TIMEOUT_MS = 20_000;

interface PooledBrowser {
  browser:  Browser;
  busy:     boolean;
  renders:  number;
}

const pool: PooledBrowser[] = [];

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',     // critical on Railway — /dev/shm is small
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  // Removed `--single-process` (Sprint D-2.5 B.5): caused "Navigating
  // frame was detached" mid-render on the insight print-theme.
  // Multi-process is Chromium's default and stable; the small memory
  // increase is acceptable at our render volume.
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync'
];

async function launchBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    headless: true,
    args:     LAUNCH_ARGS
  });
  // Auto-clear from pool on disconnect (crash, OOM-kill, etc.).
  browser.on('disconnected', () => {
    const idx = pool.findIndex((p) => p.browser === browser);
    if (idx >= 0) pool.splice(idx, 1);
  });
  return browser;
}

/** Acquire an idle browser, spawning one if pool capacity allows. */
async function acquireBrowser(): Promise<PooledBrowser> {
  // 1) reuse an idle browser
  let slot = pool.find((p) => !p.busy && p.browser.isConnected());
  if (slot) {
    if (slot.renders >= MAX_RENDERS_PER_BROWSER) {
      // Recycle: close and replace.
      await slot.browser.close().catch(() => undefined);
      const replacement = await launchBrowser();
      slot.browser = replacement;
      slot.renders = 0;
    }
    slot.busy = true;
    return slot;
  }

  // 2) spawn a new browser if pool not full
  if (pool.length < POOL_SIZE) {
    const browser = await launchBrowser();
    const created: PooledBrowser = { browser, busy: true, renders: 0 };
    pool.push(created);
    return created;
  }

  // 3) wait for a busy browser to free up (poll every 80 ms; cap 30s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 80));
    const free = pool.find((p) => !p.busy && p.browser.isConnected());
    if (free) {
      free.busy = true;
      return free;
    }
  }
  throw new Error('PDF renderer: timed out waiting for an idle browser instance.');
}

function release(slot: PooledBrowser): void {
  slot.busy = false;
  slot.renders += 1;
}

export interface RenderPdfArgs {
  html:       string;
  format?:    PaperFormat;
  margin?:    { top?: string; right?: string; bottom?: string; left?: string };
  metadata?: {
    title?:    string;
    author?:   string;
    subject?:  string;
    creator?:  string;
    producer?: string;
  };
}

export async function renderPdf(args: RenderPdfArgs): Promise<Buffer> {
  const slot = await acquireBrowser();
  let page;
  try {
    page = await slot.browser.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    await page.emulateMediaType('print');
    await page.setContent(args.html, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });

    const pdfBytes = await page.pdf({
      format:            args.format || 'A4',
      printBackground:   true,
      preferCSSPageSize: true,
      margin: args.margin || { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' }
    });

    // Apply PDF DocumentInformation metadata via pdf-lib (Chromium's
    // page.pdf() doesn't set these directly). Best-effort: if pdf-lib
    // fails for any reason, fall back to the unannotated buffer.
    if (args.metadata) {
      try {
        const doc = await PDFDocument.load(Buffer.from(pdfBytes));
        if (args.metadata.title)    doc.setTitle(args.metadata.title);
        if (args.metadata.author)   doc.setAuthor(args.metadata.author);
        if (args.metadata.subject)  doc.setSubject(args.metadata.subject);
        if (args.metadata.creator)  doc.setCreator(args.metadata.creator);
        if (args.metadata.producer) doc.setProducer(args.metadata.producer);
        const stamped = await doc.save();
        return Buffer.from(stamped);
      } catch (err) {
        console.error('[pdfRenderer] metadata stamping failed; returning raw PDF', err);
      }
    }
    return Buffer.from(pdfBytes);
  } finally {
    if (page) await page.close().catch(() => undefined);
    release(slot);
  }
}

/** Idempotent shutdown — close all browsers in the pool. */
export async function shutdownRenderer(): Promise<void> {
  const all = pool.splice(0, pool.length);
  await Promise.all(all.map((p) => p.browser.close().catch(() => undefined)));
}

/** Diagnostic — for /health endpoint. */
export function rendererStatus() {
  return {
    poolSize:    POOL_SIZE,
    instances:   pool.length,
    busy:        pool.filter((p) => p.busy).length,
    rendersByInstance: pool.map((p) => p.renders)
  };
}

// Graceful shutdown hooks (Railway sends SIGTERM).
let shutdownHooked = false;
function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const close = () => { shutdownRenderer().finally(() => process.exit(0)); };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
hookShutdown();
