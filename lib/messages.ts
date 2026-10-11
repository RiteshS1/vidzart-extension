// Typed messages between the extension's contexts.
//
//   popup ──▶ background ──▶ offscreen (recorder)
//                 │              ▲
//                 ▼              │ event batches
//              logger (content script in the recorded tab)
//
// chrome.runtime.sendMessage reaches EVERY extension context (background,
// offscreen, open extension pages), so each message names its receiver in
// `to` and every listener ignores messages that aren't for it.
// Content scripts are reached with chrome.tabs.sendMessage instead.

import type { VidzEvent, Viewport } from './vidz/types';

export type RecorderStatus =
  | { state: 'idle' }
  | { state: 'starting' }
  | { state: 'recording'; startedAt: number; tabId: number }
  | { state: 'saving' };

export type ToBackground =
  | { to: 'background'; type: 'start'; tabId: number; title: string }
  | { to: 'background'; type: 'stop' }
  | { to: 'background'; type: 'status' }
  /** From the offscreen doc once the recording is stored. */
  | { to: 'background'; type: 'recording-ready'; id: string }
  | { to: 'background'; type: 'recording-failed'; error: string };

export interface StartRecording {
  to: 'offscreen';
  type: 'start';
  streamId: string;
  tabId: number;
  title: string;
  /** Capture size limit in device px, from the tab's viewport. */
  maxWidth: number;
  maxHeight: number;
  warnings: string[];
}

export type ToOffscreen =
  | StartRecording
  | { to: 'offscreen'; type: 'stop'; finalEvents: VidzEvent[] }
  | { to: 'offscreen'; type: 'status' }
  | { to: 'offscreen'; type: 'warning'; message: string }
  /**
   * From the logger. `t` is an absolute epochNow() stamp here; the recorder
   * converts to "ms since start" when saving. `viewport` is sent once, in
   * the logger's first batch.
   */
  | { to: 'offscreen'; type: 'events'; events: VidzEvent[]; viewport?: Viewport };

export type ToLogger = { to: 'logger'; type: 'stop' };

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
