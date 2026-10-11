import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { chromium, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';

// Loads the e2e build of the extension (see wxt.config.ts → E2E) into
// Playwright's bundled Chromium. Branded Google Chrome ignores
// --load-extension since v137, so `channel: "chrome"` can't be used here.

const EXTENSION = path.resolve(import.meta.dirname, '../.output/e2e/chrome-mv3');

/** A page worth recording: a moving box and a few buttons. */
const DEMO_PAGE = `<!doctype html>
<html><head><title>Demo page</title>
<style>
  body { margin: 0; font: 16px system-ui; background: #f4f4f8; height: 3000px; }
  #box { position: fixed; top: 40px; left: 0; width: 80px; height: 80px; background: #6d5dfc; }
  button { position: fixed; padding: 12px 20px; font-size: 16px; }
  input { position: fixed; top: 300px; left: 40px; }
</style></head>
<body>
  <div id="box"></div>
  <button id="a" style="top: 200px; left: 100px">Button A</button>
  <button id="b" style="top: 400px; left: 600px">Button B</button>
  <input id="field" placeholder="type here">
  <script>
    const box = document.getElementById('box');
    const t0 = performance.now();
    (function tick() {
      box.style.transform = 'translateX(' + (((performance.now() - t0) / 5) % 900) + 'px)';
      requestAnimationFrame(tick);
    })();
  </script>
</body></html>`;

/**
 * Plays the web editor's side of the "Open in editor" handoff (the real one
 * is vidzart-app's src/lib/editor/extensionHandoff.ts) and shows what it got.
 */
const STUB_EDITOR = `<!doctype html><title>Stub editor</title><pre id="out">waiting</pre>
<script>
  addEventListener('message', async (e) => {
    if (e.data?.type !== 'vidzart:open-project') return;
    const f = e.data.file;
    document.getElementById('out').textContent = 'got ' + f.name + ' ' + f.size + ' from ' + e.origin;
  });
  opener.postMessage({ type: 'vidzart:editor-ready' }, '*');
</script>`;

interface Fixtures {
  context: BrowserContext;
  background: Worker;
  extensionId: string;
  demoUrl: string;
  /** An extension page (popup.html in a tab), for sending runtime messages. */
  extensionPage: Page;
}

export const test = base.extend<Fixtures, { server: Server }>({
  server: [
    async ({}, use) => {
      const server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(req.url?.startsWith('/editor') ? STUB_EDITOR : DEMO_PAGE);
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      await use(server);
      server.close();
    },
    { scope: 'worker' },
  ],
  demoUrl: async ({ server }, use) => {
    await use(`http://localhost:${(server.address() as AddressInfo).port}/`);
  },
  context: async ({}, use) => {
    const args = [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`];
    const launch = (extra: string[]) =>
      chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1280, height: 720 }, args: [...args, ...extra] });
    // First launch only to learn the extension id.
    const probe = await launch([]);
    const sw = probe.serviceWorkers()[0] ?? (await probe.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;
    await probe.close();
    const context = await launch([`--allowlisted-extension-id=${id}`]);
    await use(context);
    await context.close();
  },
  background: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host);
  },
  extensionPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await use(page);
  },
});

export { expect } from '@playwright/test';
