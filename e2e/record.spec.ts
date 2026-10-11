import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { readZip } from '../lib/vidz/zip';
import type { VidzEvents, VidzManifest, VidzProject } from '../lib/vidz/types';
import { test, expect } from './fixtures';

// The whole flow against the real extension: start recording a page, use
// it, stop, then check the "Recording ready" page and the .vidz it produces.
// Starting is done with a runtime message (what the popup sends), because
// automation can't click the toolbar icon.

async function send(extensionPage: Page, message: object) {
  return extensionPage.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

async function startRecording(extensionPage: Page, url: string) {
  const result = await extensionPage.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return chrome.runtime.sendMessage({ to: 'background', type: 'start', tabId: tab!.id, title: tab!.title });
  }, url);
  expect(result).toEqual({ ok: true });
}

test('records a tab with its events and produces a valid .vidz', async ({ context, extensionPage, demoUrl }, testInfo) => {
  const demo = await context.newPage();
  await demo.goto(demoUrl);
  await demo.bringToFront();
  await startRecording(extensionPage, demoUrl);
  expect(await send(extensionPage, { to: 'background', type: 'status' })).toMatchObject({ state: 'recording' });

  // Use the page: move, click two buttons, type (must NOT be logged), a
  // shortcut (must be logged), scroll.
  await demo.mouse.move(50, 50);
  await demo.waitForTimeout(300);
  await demo.click('#a');
  await demo.waitForTimeout(400);
  await demo.click('#field');
  await demo.keyboard.type('secret');
  await demo.keyboard.press('Shift+A');
  await demo.keyboard.press('Control+K');
  await demo.click('#b');
  await demo.mouse.wheel(0, 400);
  await demo.waitForTimeout(1500); // > one logger batch

  const readyPagePromise = context.waitForEvent('page', (p) => p.url().includes('/ready.html'));
  expect(await send(extensionPage, { to: 'background', type: 'stop' })).toEqual({ ok: true });
  const ready = await readyPagePromise;

  await expect(ready.getByRole('heading', { name: 'Recording ready' })).toBeVisible();
  await expect(ready.getByTestId('recording-title')).toHaveText('Demo page');
  await expect(ready.getByTestId('recording-facts')).toContainText('3 clicks tracked');
  expect(await send(extensionPage, { to: 'background', type: 'status' })).toEqual({ state: 'idle' });

  const [download] = await Promise.all([ready.waitForEvent('download'), ready.getByRole('link', { name: 'Save .vidz' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^demo-page-\d{4}-\d{2}-\d{2}-\d{4}\.vidz$/);
  const file = testInfo.outputPath('rec.vidz');
  await download.saveAs(file);

  const entries = await readZip(new Blob([new Uint8Array(readFileSync(file))]));
  const manifest = JSON.parse(await entries.get('manifest.json')!.text()) as VidzManifest;
  expect(manifest).toMatchObject({ format: 'vidzart-project', createdBy: { app: 'vidzart-extension' } });
  const project = JSON.parse(await entries.get(manifest.files.project)!.text()) as VidzProject;
  const events = JSON.parse(await entries.get(manifest.files.events!)!.text()) as VidzEvents;
  const video = await entries.get(manifest.files.video)!.blob();

  // Video: real size, measured duration.
  expect(video.size).toBeGreaterThan(10_000);
  expect(project.source.width).toBeGreaterThan(0);
  expect(project.source.height).toBeGreaterThan(0);
  expect(project.source.duration).toBeGreaterThan(2000);

  // Events: the viewport, clicks at the buttons, the shortcut and nothing typed.
  expect(events.viewport).toMatchObject({ width: 1280, height: 720 });
  const clicks = events.events.filter((e) => e.type === 'click');
  expect(clicks).toHaveLength(3);
  for (const click of clicks) {
    expect(click.t).toBeGreaterThan(0);
    expect(click.t).toBeLessThan(project.source.duration);
  }
  // #a is at left 100, top 200 (Playwright clicks the center).
  expect(clicks[0]!.x).toBeGreaterThan(100);
  expect(clicks[0]!.y).toBeGreaterThan(200);
  expect(clicks[0]!.y).toBeLessThan(260);
  const keys = events.events.filter((e) => e.type === 'key');
  expect(keys.map((k) => (k.type === 'key' ? k.combo : ''))).toEqual(['Ctrl+K']);
  expect(JSON.stringify(events)).not.toContain('secret');
  expect(events.events.some((e) => e.type === 'move')).toBe(true);
  expect(events.events.some((e) => e.type === 'scroll' && e.scrollY > 0)).toBe(true);
  // Sorted by time.
  const times = events.events.map((e) => e.t);
  expect(times).toEqual([...times].sort((a, b) => a - b));
});

test('Open in editor hands the .vidz to the editor tab', async ({ context, extensionPage, demoUrl }) => {
  const demo = await context.newPage();
  await demo.goto(demoUrl);
  await startRecording(extensionPage, demoUrl);
  await demo.click('#a');
  await demo.waitForTimeout(1200);
  const readyPagePromise = context.waitForEvent('page', (p) => p.url().includes('/ready.html'));
  await send(extensionPage, { to: 'background', type: 'stop' });
  const ready = await readyPagePromise;

  await ready.getByText('Editor address').click();
  await ready.getByRole('textbox').fill(`${demoUrl}editor`);
  const editorPromise = context.waitForEvent('page', (p) => p.url().includes('/editor'));
  await ready.getByRole('button', { name: 'Open in editor' }).click();
  const editor = await editorPromise;
  expect(new URL(editor.url()).searchParams.get('from')).toBe('extension');
  await expect(editor.locator('#out')).toHaveText(/^got demo-page-.*\.vidz \d+ from chrome-extension:\/\//);
  await expect(ready.getByText('Opened in the editor tab.')).toBeVisible();
});

test('still records the video when cursor tracking is impossible', async ({ context, extensionPage, demoUrl }) => {
  // The e2e build may only script http://localhost, so on 127.0.0.1 the
  // logger can't be injected, like on a chrome:// page in real use.
  const url = demoUrl.replace('localhost', '127.0.0.1');
  const demo = await context.newPage();
  await demo.goto(url);
  // Without host access, tabs.query can't match the URL; the newest tab is ours.
  const result = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.reduce((a, b) => (b.id! > a.id! ? b : a));
    return chrome.runtime.sendMessage({ to: 'background', type: 'start', tabId: tab.id, title: 'No logger' });
  });
  expect(result).toEqual({ ok: true });
  await demo.waitForTimeout(1200);
  const readyPagePromise = context.waitForEvent('page', (p) => p.url().includes('/ready.html'));
  await send(extensionPage, { to: 'background', type: 'stop' });
  const ready = await readyPagePromise;
  await expect(ready.getByTestId('recording-facts')).toContainText('no cursor data');
  await expect(ready.getByText("Cursor and clicks couldn't be recorded on this page")).toBeVisible();
  await expect(ready.getByRole('link', { name: 'Save .vidz' })).toBeVisible();
});

test('refuses to start twice', async ({ context, extensionPage, demoUrl }) => {
  const demo = await context.newPage();
  await demo.goto(demoUrl);
  await startRecording(extensionPage, demoUrl);
  const again = (await extensionPage.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    return chrome.runtime.sendMessage({ to: 'background', type: 'start', tabId: tab!.id, title: 'x' });
  }, demoUrl)) as { ok: boolean; error?: string };
  expect(again).toEqual({ ok: false, error: 'Already recording.' });
});
