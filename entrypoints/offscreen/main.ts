// The offscreen document: a hidden extension page that does the actual
// recording.
//
// Why it exists: an MV3 background service worker has no DOM, so no
// getUserMedia or MediaRecorder, and Chrome may kill it after ~30s idle. This
// document lives until we close it and OWNS all recording state; the
// background only forwards commands and asks it for status.

import { browser, type Browser } from 'wxt/browser';
import { epochNow } from '@/lib/clock';
import { errorMessage, type RecorderStatus, type Result, type StartRecording, type ToBackground, type ToOffscreen } from '@/lib/messages';
import { pickRecorderMimeType } from '@/lib/mimeType';
import { putRecording } from '@/lib/recordings';
import { toEventsJson } from '@/lib/vidz/build';
import type { VidzEvent, Viewport } from '@/lib/vidz/types';

/** Emit a chunk every second, so a crash loses at most ~1s of video. */
const TIMESLICE_MS = 1000;

interface Session {
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext;
  chunks: Blob[];
  mimeType: string;
  startedAt: number;
  tabId: number;
  title: string;
  events: VidzEvent[];
  viewport: Viewport | null;
  warnings: string[];
  stopping: boolean;
}

let session: Session | null = null;
let starting = false;

browser.runtime.onMessage.addListener((message: ToOffscreen, _sender: Browser.runtime.MessageSender, reply: (r: unknown) => void) => {
  if (message?.to !== 'offscreen') return;
  switch (message.type) {
    case 'start':
      start(message).then(reply, (error) => reply({ ok: false, error: errorMessage(error) } satisfies Result));
      return true; // keep the channel open for the async reply
    case 'stop':
      if (session) session.events.push(...message.finalEvents);
      void finish();
      reply({ ok: true });
      return;
    case 'status':
      reply(status());
      return;
    case 'warning':
      if (session && !session.warnings.includes(message.message)) session.warnings.push(message.message);
      return;
    case 'events':
      if (!session && !starting) return;
      // Events can arrive while getUserMedia is still starting; keep them
      // (they're filtered by time when saving).
      pendingEvents.push(...message.events);
      if (message.viewport) pendingViewport ??= message.viewport;
      if (session) flushPending(session);
      return;
  }
});

// Events/viewport that arrive before the session object exists.
let pendingEvents: VidzEvent[] = [];
let pendingViewport: Viewport | null = null;
function flushPending(s: Session) {
  s.events.push(...pendingEvents);
  s.viewport ??= pendingViewport;
  pendingEvents = [];
}

function status(): RecorderStatus {
  if (starting) return { state: 'starting' };
  if (!session) return { state: 'idle' };
  if (session.stopping) return { state: 'saving' };
  return { state: 'recording', startedAt: session.startedAt, tabId: session.tabId };
}

async function start(command: StartRecording): Promise<Result<{ startedAt: number }>> {
  if (session || starting) return { ok: false, error: 'Already recording.' };
  starting = true;
  pendingEvents = [];
  pendingViewport = null;
  try {
    const mimeType = pickRecorderMimeType();
    if (!mimeType) throw new Error("This browser can't record video (MediaRecorder unsupported).");

    // Tab capture through getUserMedia uses Chrome's legacy "mandatory"
    // constraints; the stream id from chrome.tabCapture.getMediaStreamId
    // says which tab. Not in the standard TS types, hence the cast.
    const tab = { chromeMediaSource: 'tab', chromeMediaSourceId: command.streamId };
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: tab },
      video: {
        mandatory: {
          ...tab,
          // Without max sizes Chrome captures at a low default resolution.
          // These are the tab's size in device pixels, so the video is as
          // sharp as the screen; smaller tabs are never upscaled.
          maxWidth: command.maxWidth,
          maxHeight: command.maxHeight,
          maxFrameRate: 60,
        },
      },
    } as unknown as MediaStreamConstraints);

    // Capturing a tab mutes it for the user. Play the captured audio back so
    // they still hear the page while recording.
    const audio = new AudioContext();
    if (stream.getAudioTracks().length) audio.createMediaStreamSource(stream).connect(audio.destination);

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrateFor(command) });
    const s: Session = {
      recorder,
      stream,
      audio,
      chunks: [],
      mimeType,
      startedAt: 0,
      tabId: command.tabId,
      title: command.title,
      events: [],
      viewport: null,
      warnings: [...command.warnings],
      stopping: false,
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) s.chunks.push(event.data);
    };
    // The tab was closed (or capture ended some other way): save what we have.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => void finish());

    // startedAt is the zero point of events.json, taken when the recorder
    // really starts, not when we asked it to.
    await new Promise<void>((resolve, reject) => {
      recorder.onstart = () => {
        s.startedAt = epochNow();
        resolve();
      };
      recorder.onerror = (event) => reject(new Error(`Recorder error: ${String((event as ErrorEvent).error ?? event.type)}`));
      recorder.start(TIMESLICE_MS);
    });
    session = s;
    flushPending(s);
    return { ok: true, startedAt: s.startedAt };
  } finally {
    starting = false;
  }
}

/**
 * Raw recordings are re-encoded at export, so they should be high quality:
 * ~4 bits per pixel per second, e.g. ≈8 Mbps at 1080p, capped at 25 Mbps.
 */
function bitrateFor(command: StartRecording): number {
  return Math.min(25_000_000, Math.max(4_000_000, command.maxWidth * command.maxHeight * 4));
}

async function finish() {
  const s = session;
  if (!s || s.stopping) return;
  s.stopping = true;
  try {
    const stoppedAt = await new Promise<number>((resolve) => {
      s.recorder.onstop = () => resolve(epochNow());
      if (s.recorder.state === 'inactive') resolve(epochNow());
      else s.recorder.stop();
    });
    s.stream.getTracks().forEach((track) => track.stop());
    void s.audio.close();

    const video = new Blob(s.chunks, { type: s.mimeType });
    // Measured, not read from the file (see the spec on source.duration).
    const durationMs = stoppedAt - s.startedAt;
    const size = await measureVideo(video).catch(() => {
      const settings = s.stream.getVideoTracks()[0]?.getSettings();
      return { width: settings?.width ?? 0, height: settings?.height ?? 0 };
    });
    const fps = Math.round(s.stream.getVideoTracks()[0]?.getSettings().frameRate ?? 30);

    const events = s.viewport
      ? toEventsJson(s.events, { startedAt: s.startedAt, durationMs, viewport: s.viewport })
      : null;
    const id = crypto.randomUUID();
    await putRecording({
      id,
      createdAt: Date.now(),
      title: s.title,
      video,
      mimeType: s.mimeType,
      durationMs,
      width: size.width,
      height: size.height,
      fps,
      events,
      warnings: s.warnings,
    });
    await notify({ to: 'background', type: 'recording-ready', id });
  } catch (error) {
    await notify({ to: 'background', type: 'recording-failed', error: errorMessage(error) });
  } finally {
    session = null;
  }
}

function notify(message: ToBackground) {
  return browser.runtime.sendMessage(message).catch(() => {});
}

/**
 * The real decoded size, from a <video> element. The capture constraints
 * were only limits, and the coordinate mapping in the editor must use the
 * actual video size (spec → Coordinate mapping).
 */
function measureVideo(video: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const element = document.createElement('video');
    const url = URL.createObjectURL(video);
    const done = () => URL.revokeObjectURL(url);
    element.muted = true;
    element.onloadedmetadata = () => {
      done();
      if (element.videoWidth > 0) resolve({ width: element.videoWidth, height: element.videoHeight });
      else reject(new Error('No video size.'));
    };
    element.onerror = () => {
      done();
      reject(new Error('Unreadable video.'));
    };
    element.src = url;
  });
}
