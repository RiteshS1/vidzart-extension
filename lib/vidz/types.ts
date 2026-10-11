// TypeScript mirror of the .vidz format (CLAUDE.md → Project file format).
// The spec is the source of truth; vidzart-app has the same types in
// src/lib/{events,project}/types.ts and src/lib/vidz/vidzFile.ts.

export type MouseButton = 0 | 1 | 2;

export type VidzEvent =
  | { t: number; type: 'move'; x: number; y: number }
  | { t: number; type: 'down'; x: number; y: number; button: MouseButton }
  | { t: number; type: 'up'; x: number; y: number; button: MouseButton }
  | { t: number; type: 'click'; x: number; y: number; button: MouseButton }
  | { t: number; type: 'scroll'; x: number; y: number; scrollX: number; scrollY: number }
  | { t: number; type: 'key'; x: number; y: number; combo: string }
  | { t: number; type: 'resize'; width: number; height: number; devicePixelRatio: number };

export interface Viewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface VidzEvents {
  version: 1;
  viewport: Viewport;
  startedAt: number;
  events: VidzEvent[];
}

export interface ProjectSettings {
  aspectRatio: 'source' | '16:9' | '9:16' | '1:1' | '4:3';
  background:
    | { type: 'color'; color: string }
    | { type: 'gradient'; from: string; to: string; angle: number }
    | { type: 'image'; src: string };
  padding: number;
  cornerRadius: number;
  shadow: { enabled: boolean; blur: number; opacity: number; offsetY: number };
  cursor: { visible: boolean; scale: number; smoothing: number; hideWhenIdleMs?: number };
  clickEffect: { type: 'none' | 'ripple' | 'pulse'; color: string };
}

export interface VidzProject {
  version: 1;
  source: { duration: number; width: number; height: number; fps: number; eventsOffsetMs?: number };
  settings: ProjectSettings;
  // The extension never writes segments (editing happens in the app), so
  // this stays loosely typed here.
  segments: unknown[];
}

export interface VidzManifest {
  format: 'vidzart-project';
  version: 1;
  createdAt: string;
  createdBy: { app: 'vidzart-extension' | 'vidzart-app'; version: string };
  files: { video: string; events?: string; project: string };
}
