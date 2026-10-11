import { test, expect } from './fixtures';

// Full round trip with the REAL web editor (vidzart-app). Opt-in, because
// the app lives in another repo: start it, then run e.g.
//   VIDZART_EDITOR_URL=http://localhost:3000/editor pnpm test:e2e
const EDITOR_URL = process.env.VIDZART_EDITOR_URL;

test('a recording opens in the real editor with its events', async ({ context, extensionPage, demoUrl }) => {
  test.skip(!EDITOR_URL, 'set VIDZART_EDITOR_URL to run against the real app');
  const demo = await context.newPage();
  await demo.goto(demoUrl);
  const started = await extensionPage.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return chrome.runtime.sendMessage({ to: 'background', type: 'start', tabId: tab!.id, title: tab!.title });
  }, demoUrl);
  expect(started).toEqual({ ok: true });
  await demo.mouse.move(100, 100);
  await demo.waitForTimeout(500);
  await demo.click('#a');
  await demo.waitForTimeout(1500);
  await demo.click('#b');
  await demo.waitForTimeout(1500);

  const readyPromise = context.waitForEvent('page', (p) => p.url().includes('/ready.html'));
  await extensionPage.evaluate(() => chrome.runtime.sendMessage({ to: 'background', type: 'stop' }));
  const ready = await readyPromise;
  await ready.getByText('Editor address').click();
  await ready.getByRole('textbox').fill(EDITOR_URL!);
  const editorPromise = context.waitForEvent('page', (p) => p.url().includes('/editor'));
  await ready.getByRole('button', { name: 'Open in editor' }).click();
  const editor = await editorPromise;

  // The editor opened the .vidz: file name shown, and Auto zoom (only offered
  // when there's an event log) finds the two clicks.
  await expect(editor.getByTestId('file-name')).toHaveText(/^demo-page-.*\.vidz$/, { timeout: 30_000 });
  await editor.getByRole('button', { name: 'Auto zoom' }).click();
  await expect(editor.getByRole('status')).toHaveText(/Added [12] auto zooms?/);
  expect(new URL(editor.url()).search).toBe(''); // ?from=extension removed
});
