import { describe, expect, it } from 'vitest';
import { buildVidz, toEventsJson, videoNameFor } from './build';
import type { VidzEvent } from './types';
import { readZip } from './zip';

const viewport = { width: 1280, height: 720, devicePixelRatio: 2 };

describe('toEventsJson', () => {
  it('converts epoch stamps to ms since start, sorted, dropping far-off events', () => {
    const startedAt = 1_760_000_000_000;
    const stamped: VidzEvent[] = [
      { t: startedAt + 500, type: 'click', x: 10, y: 20, button: 0 },
      { t: startedAt - 10_000, type: 'move', x: 0, y: 0 }, // long before: dropped
      { t: startedAt - 100.04, type: 'move', x: 5, y: 5 }, // just before: kept
      { t: startedAt + 99_000, type: 'move', x: 1, y: 1 }, // after the end: dropped
    ];
    const json = toEventsJson(stamped, { startedAt, durationMs: 3000, viewport });
    expect(json.startedAt).toBe(startedAt);
    expect(json.events.map((e) => [e.type, e.t])).toEqual([
      ['move', -100],
      ['click', 500],
    ]);
  });
});

describe('buildVidz', () => {
  it('writes a .vidz the app can read: manifest, stored video, project, events', async () => {
    const video = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/webm' });
    const events = toEventsJson([], { startedAt: 1, durationMs: 1000, viewport });
    const vidz = await buildVidz(
      { video, mimeType: 'video/webm;codecs=vp9,opus', durationMs: 1000, width: 1280, height: 720, fps: 30, events },
      '0.1.0',
    );
    const entries = await readZip(vidz);
    const manifest = JSON.parse(await entries.get('manifest.json')!.text());
    expect(manifest).toMatchObject({
      format: 'vidzart-project',
      version: 1,
      createdBy: { app: 'vidzart-extension', version: '0.1.0' },
      files: { video: 'video.webm', events: 'events.json', project: 'project.json' },
    });
    const stored = await entries.get('video.webm')!.blob();
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    const project = JSON.parse(await entries.get('project.json')!.text());
    expect(project.source).toEqual({ duration: 1000, width: 1280, height: 720, fps: 30 });
    expect(JSON.parse(await entries.get('events.json')!.text()).viewport).toEqual(viewport);
  });

  it('leaves events out of the manifest when there are none', async () => {
    const vidz = await buildVidz(
      { video: new Blob([]), mimeType: 'video/mp4', durationMs: 1, width: 2, height: 2, fps: 30, events: null },
      '0.1.0',
    );
    const entries = await readZip(vidz);
    expect(entries.has('events.json')).toBe(false);
    expect(entries.has('video.mp4')).toBe(true);
    expect(videoNameFor('video/mp4;codecs=avc1')).toBe('video.mp4');
  });
});
