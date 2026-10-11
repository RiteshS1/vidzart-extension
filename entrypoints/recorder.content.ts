// The event logger. NOT injected automatically: the background injects it
// with chrome.scripting.executeScript into the tab being recorded, right
// before recording starts (registration: 'runtime' keeps it out of the
// manifest's content_scripts, so it needs no host permissions).
//
// It records what the editor needs for auto zoom, the smoothed cursor and
// click effects, in viewport CSS px (clientX/clientY), stamped with
// epochNow() so the times line up with the recorder in the offscreen doc.

import { browser, type Browser } from 'wxt/browser';
import { epochNow } from '@/lib/clock';
import { shortcutCombo } from '@/lib/keyCombo';
import type { ToLogger, ToOffscreen } from '@/lib/messages';
import type { MouseButton, VidzEvent, Viewport } from '@/lib/vidz/types';

/** Batches are sent this often, so a navigation loses at most ~1s of events. */
const FLUSH_MS = 1000;

declare global {
  interface Window {
    // Content scripts of one extension share an "isolated world" per page,
    // so a second injection (e.g. recording the same tab twice) sees this.
    __vidzartLoggerStop?: () => VidzEvent[];
  }
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    // A logger from an earlier recording of this tab is still running? Stop
    // it first so events aren't logged twice.
    window.__vidzartLoggerStop?.();
    startLogger();
  },
});

function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio };
}

const round = (n: number) => Math.round(n * 10) / 10;

function startLogger() {
  let pending: VidzEvent[] = [];
  let pointer = { x: 0, y: 0 };
  let firstBatch = true;

  const send = () => {
    if (pending.length === 0 && !firstBatch) return;
    const message: ToOffscreen = {
      to: 'offscreen',
      type: 'events',
      events: pending,
      ...(firstBatch ? { viewport: viewport() } : {}),
    };
    pending = [];
    firstBatch = false;
    // Fire and forget: if the extension was reloaded mid-recording there's
    // nobody listening anymore, which isn't worth an error in the page.
    browser.runtime.sendMessage(message).catch(() => {});
  };

  // The current viewport, as an event: lets the editor map coordinates
  // correctly even when this logger was re-injected after a navigation.
  const logResize = () => pending.push({ t: epochNow(), type: 'resize', ...viewport() });
  logResize();

  // --- pointer moves and scrolls: at most one per animation frame ----------
  // Browsers can fire pointermove at 120Hz+ (and more with coalescing); the
  // spec asks for ≤ 1 per frame. We remember the latest position and log it
  // on the next frame.
  let moveQueued = false;
  let scrollQueued = false;
  let frame = 0;
  const onFrame = () => {
    frame = 0;
    const t = epochNow();
    if (moveQueued) pending.push({ t, type: 'move', x: pointer.x, y: pointer.y });
    if (scrollQueued) {
      pending.push({ t, type: 'scroll', x: pointer.x, y: pointer.y, scrollX: round(window.scrollX), scrollY: round(window.scrollY) });
    }
    moveQueued = scrollQueued = false;
  };
  const queueFrame = () => {
    if (!frame) frame = requestAnimationFrame(onFrame);
  };

  const onMove = (event: PointerEvent) => {
    pointer = { x: round(event.clientX), y: round(event.clientY) };
    moveQueued = true;
    queueFrame();
  };
  const onScroll = () => {
    scrollQueued = true;
    queueFrame();
  };

  const button = (event: MouseEvent): MouseButton | null =>
    event.button === 0 || event.button === 1 || event.button === 2 ? event.button : null; // skip back/forward buttons
  const logButton = (type: 'down' | 'up' | 'click') => (event: MouseEvent) => {
    const b = button(event);
    if (b === null) return;
    pointer = { x: round(event.clientX), y: round(event.clientY) };
    pending.push({ t: epochNow(), type, x: pointer.x, y: pointer.y, button: b });
  };
  const onDown = logButton('down');
  const onUp = logButton('up');
  const onClick = logButton('click');
  // A right click fires "contextmenu" instead of "click".
  const onContextMenu = logButton('click');

  const onKey = (event: KeyboardEvent) => {
    const combo = shortcutCombo(event);
    if (combo) pending.push({ t: epochNow(), type: 'key', x: pointer.x, y: pointer.y, combo });
  };

  // Browser zoom changes devicePixelRatio and fires "resize" too.
  const onResize = () => logResize();

  // Capture phase + passive: we see events even if the page stops their
  // propagation, and we never delay or block the page's own handling.
  const options: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointermove', onMove, options);
  window.addEventListener('pointerdown', onDown, options);
  window.addEventListener('pointerup', onUp, options);
  window.addEventListener('click', onClick, options);
  window.addEventListener('contextmenu', onContextMenu, options);
  window.addEventListener('keydown', onKey, options);
  // Scroll events don't bubble, but they do reach window in the capture
  // phase, which also catches scrolling inside scrollable elements.
  window.addEventListener('scroll', onScroll, options);
  window.addEventListener('resize', onResize, options);

  send(); // first batch: viewport + initial resize event
  const timer = setInterval(send, FLUSH_MS);

  const stop = (): VidzEvent[] => {
    clearInterval(timer);
    if (frame) cancelAnimationFrame(frame);
    onFrame();
    window.removeEventListener('pointermove', onMove, options);
    window.removeEventListener('pointerdown', onDown, options);
    window.removeEventListener('pointerup', onUp, options);
    window.removeEventListener('click', onClick, options);
    window.removeEventListener('contextmenu', onContextMenu, options);
    window.removeEventListener('keydown', onKey, options);
    window.removeEventListener('scroll', onScroll, options);
    window.removeEventListener('resize', onResize, options);
    browser.runtime.onMessage.removeListener(onMessage);
    delete window.__vidzartLoggerStop;
    const rest = pending;
    pending = [];
    return rest;
  };
  window.__vidzartLoggerStop = stop;

  // Stop: the background asks for whatever hasn't been sent yet and hands it
  // to the recorder together with the stop command, so nothing is lost.
  const onMessage = (message: ToLogger, _sender: Browser.runtime.MessageSender, reply: (r: unknown) => void) => {
    if (message?.to !== 'logger' || message.type !== 'stop') return;
    reply({ events: stop() });
  };
  browser.runtime.onMessage.addListener(onMessage);
}
