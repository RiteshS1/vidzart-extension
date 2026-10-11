// Turns a finished recording into a .vidz project file.

import type { VidzEvent, VidzEvents, VidzManifest, VidzProject, Viewport } from './types';
import { writeZip, type ZipInput } from './zip';

/**
 * Same defaults as vidzart-app's DEFAULT_SETTINGS, so a recording opens in
 * the editor looking the same as a plain video would.
 */
export const DEFAULT_SETTINGS: VidzProject['settings'] = {
  aspectRatio: '16:9',
  background: { type: 'gradient', from: '#6d5dfc', to: '#d16ba5', angle: 135 },
  padding: 0.08,
  cornerRadius: 0.02,
  shadow: { enabled: true, blur: 0.04, opacity: 0.45, offsetY: 0.012 },
  cursor: { visible: true, scale: 1, smoothing: 0.5 },
  clickEffect: { type: 'ripple', color: '#ffffff' },
};

/**
 * Events from the logger carry absolute "epoch ms" stamps in `t`
 * (performance.timeOrigin + performance.now(), see Clock sync). The file
 * stores times relative to the recorder's start instead.
 */
export function toEventsJson(
  stamped: readonly VidzEvent[],
  options: { startedAt: number; durationMs: number; viewport: Viewport },
): VidzEvents {
  // Keep a little before the start (the cursor's position just before
  // recording began is useful) but nothing far outside the video.
  const from = -2000;
  const to = options.durationMs + 1000;
  const events = stamped
    .map((event) => ({ ...event, t: Math.round((event.t - options.startedAt) * 10) / 10 }))
    .filter((event) => event.t >= from && event.t <= to)
    .sort((a, b) => a.t - b.t);
  return { version: 1, viewport: options.viewport, startedAt: options.startedAt, events };
}

export interface RecordingParts {
  video: Blob;
  mimeType: string;
  /** Measured from the recorder's start/stop events, not read from the file. */
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** null when the logger couldn't run in the tab (e.g. a chrome:// page). */
  events: VidzEvents | null;
}

export function videoNameFor(mimeType: string): 'video.webm' | 'video.mp4' {
  return mimeType.startsWith('video/mp4') ? 'video.mp4' : 'video.webm';
}

export function createProject(parts: RecordingParts): VidzProject {
  return {
    version: 1,
    source: { duration: parts.durationMs, width: parts.width, height: parts.height, fps: parts.fps },
    settings: structuredClone(DEFAULT_SETTINGS),
    segments: [],
  };
}

export async function buildVidz(parts: RecordingParts, extensionVersion: string): Promise<Blob> {
  const videoName = videoNameFor(parts.mimeType);
  const manifest: VidzManifest = {
    format: 'vidzart-project',
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: { app: 'vidzart-extension', version: extensionVersion },
    files: {
      video: videoName,
      ...(parts.events ? { events: 'events.json' } : {}),
      project: 'project.json',
    },
  };
  const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });
  const inputs: ZipInput[] = [
    { name: 'manifest.json', data: json(manifest), compress: true },
    // Already compressed: stored as-is (spec), so the editor can slice it
    // out of the zip without copying.
    { name: videoName, data: parts.video },
    { name: 'project.json', data: json(createProject(parts)), compress: true },
  ];
  if (parts.events) inputs.push({ name: 'events.json', data: json(parts.events), compress: true });
  return writeZip(inputs);
}
