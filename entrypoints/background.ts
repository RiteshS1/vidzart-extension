// The MV3 service worker: orchestrates recording (CLAUDE.md → Recording flow).
//
// Chrome stops this worker after ~30s idle and restarts it on the next
// event, so it keeps NO state in variables. The offscreen document owns the
// recording, and "are we recording?" is always asked of it.

import { browser, type Browser } from 'wxt/browser';
import { epochNow } from '@/lib/clock';
import {
  errorMessage,
  type RecorderStatus,
  type Result,
  type ToBackground,
  type ToLogger,
  type ToOffscreen,
} from '@/lib/messages';
import type { VidzEvent, Viewport } from '@/lib/vidz/types';

const LOGGER_FILE = '/content-scripts/recorder.js';
const OFFSCREEN_URL = '/offscreen.html';
/** Biggest capture we ask for, in device px (4K), whatever the screen. */
const MAX_CAPTURE = { width: 3840, height: 2160 };

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: ToBackground, _sender: Browser.runtime.MessageSender, reply: (r: unknown) => void) => {
    if (message?.to !== 'background') return;
    handle(message).then(reply, (error) => reply({ ok: false, error: errorMessage(error) } satisfies Result));
    return true; // async reply
  });

  // Keyboard shortcut (manifest "commands"): start/stop without opening the
  // popup. Like an action click, a command grants activeTab for the tab.
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-recording') return;
    void (async () => {
      const status = await recorderStatus();
      if (status.state === 'recording') await stop();
      else if (status.state === 'idle' && tab?.id !== undefined) {
        const result = await start(tab.id, tab.title ?? 'Recording');
        if (!result.ok) await showError(result.error);
      }
    })();
  });

  // The recorded tab loaded a new page: the old logger died with the old
  // page, so try to inject a new one. That only works while activeTab still
  // covers the tab (Chrome may revoke it on navigation); otherwise the video
  // keeps recording but cursor tracking stops, and the ready page says so.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'complete') return;
    void (async () => {
      const status = await recorderStatus();
      if (status.state !== 'recording' || status.tabId !== tabId) return;
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: [LOGGER_FILE] });
      } catch {
        const at = formatTime(epochNow() - status.startedAt);
        await sendToOffscreen({
          to: 'offscreen',
          type: 'warning',
          message: `The page navigated at ${at}; cursor and clicks after that weren't recorded.`,
        });
      }
    })();
  });
});

async function handle(message: ToBackground): Promise<unknown> {
  switch (message.type) {
    case 'start':
      return start(message.tabId, message.title);
    case 'stop':
      return stop();
    case 'status':
      return recorderStatus();
    case 'recording-ready':
      await finishUi();
      await browser.tabs.create({ url: browser.runtime.getURL(`/ready.html#${message.id}`) });
      return { ok: true };
    case 'recording-failed':
      await finishUi();
      await showError(message.error);
      return { ok: true };
  }
}

async function start(tabId: number, title: string): Promise<Result> {
  if ((await recorderStatus()).state !== 'idle') return { ok: false, error: 'Already recording.' };
  const warnings: string[] = [];

  // 1. Inject the event logger first, so the cursor position right before
  //    the recorder starts is known too.
  let viewport: Viewport | null = null;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [LOGGER_FILE] });
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }),
    });
    viewport = result?.result ?? null;
  } catch {
    // e.g. chrome:// pages or the Chrome Web Store, where extensions can't run.
    warnings.push("Cursor and clicks couldn't be recorded on this page, so auto zoom won't be available.");
  }
  // Capture at the tab's size in device pixels: as sharp as the screen.
  // Without the logger, guess from the tab size (CSS px) at 2x.
  const tab = viewport ? null : await browser.tabs.get(tabId);
  const size = viewport
    ? { width: viewport.width * viewport.devicePixelRatio, height: viewport.height * viewport.devicePixelRatio }
    : { width: (tab?.width ?? 1920) * 2, height: (tab?.height ?? 1080) * 2 };
  const capture = fitWithin(size, MAX_CAPTURE);

  try {
    // 2. The offscreen document hosts MediaRecorder (no DOM in a worker).
    await ensureOffscreen();
    // 3. A stream id for this tab. Requires the user to have invoked the
    //    extension on it (popup click or shortcut): that's the activeTab grant.
    const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
    // 4. Start recording.
    const result = (await sendToOffscreen({
      to: 'offscreen',
      type: 'start',
      streamId,
      tabId,
      title,
      viewport,
      maxWidth: capture.width,
      maxHeight: capture.height,
      warnings,
    })) as Result;
    if (!result.ok) throw new Error(result.error);
  } catch (error) {
    await stopLogger(tabId);
    await browser.offscreen.closeDocument().catch(() => {});
    return { ok: false, error: friendlyCaptureError(errorMessage(error)) };
  }

  await browser.action.setBadgeBackgroundColor({ color: '#dc2626' });
  await browser.action.setBadgeText({ text: 'REC' });
  return { ok: true };
}

async function stop(): Promise<Result> {
  const status = await recorderStatus();
  if (status.state !== 'recording') return { ok: false, error: 'Not recording.' };
  await browser.action.setBadgeText({ text: '…' });
  // Collect the logger's unsent events and hand them over with the stop
  // command, so the last second of clicks isn't lost.
  const finalEvents = await stopLogger(status.tabId);
  await sendToOffscreen({ to: 'offscreen', type: 'stop', finalEvents });
  return { ok: true };
}

async function stopLogger(tabId: number): Promise<VidzEvent[]> {
  const message: ToLogger = { to: 'logger', type: 'stop' };
  try {
    const reply = (await browser.tabs.sendMessage(tabId, message)) as { events?: VidzEvent[] } | undefined;
    return reply?.events ?? [];
  } catch {
    return []; // tab closed, navigated, or no logger was injected
  }
}

async function recorderStatus(): Promise<RecorderStatus> {
  if (!(await browser.offscreen.hasDocument())) return { state: 'idle' };
  try {
    return ((await sendToOffscreen({ to: 'offscreen', type: 'status' })) as RecorderStatus | undefined) ?? { state: 'idle' };
  } catch {
    return { state: 'idle' };
  }
}

async function ensureOffscreen() {
  if (await browser.offscreen.hasDocument()) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [browser.offscreen.Reason.USER_MEDIA],
    justification: 'Records the tab with MediaRecorder, which service workers do not have.',
  });
}

function sendToOffscreen(message: ToOffscreen): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

async function finishUi() {
  await browser.action.setBadgeText({ text: '' });
  await browser.offscreen.closeDocument().catch(() => {});
}

async function showError(error: string) {
  await browser.tabs.create({ url: browser.runtime.getURL(`/ready.html#error=${encodeURIComponent(error)}`) });
}

function friendlyCaptureError(message: string): string {
  // Chrome's message for both cases is "Extension has not been invoked for
  // the current page (see activeTab permission). Chrome pages cannot be
  // captured.", so it can't tell us which one happened.
  if (/has not been invoked|cannot be captured/i.test(message)) {
    return "Chrome didn't allow recording this tab. Open the Vidzart popup on the tab you want to record and press Record again. Browser pages (chrome://, the Web Store) can't be recorded.";
  }
  return message;
}

/** Scales a size down (never up) to fit within a box, keeping the aspect ratio, as even numbers. */
function fitWithin(size: { width: number; height: number }, box: { width: number; height: number }) {
  const scale = Math.min(1, box.width / size.width, box.height / size.height);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(size.width), height: even(size.height) };
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
