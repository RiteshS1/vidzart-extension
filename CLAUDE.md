# vidzart-extension

The Vidzart **Chrome extension (Manifest V3)**: records the current tab and, at the same time,
logs cursor/click events, then produces a `.vidz` project file for the Vidzart editor. This repo is
developed and published on its own; this file is meant to be all the context you need. The
companion repo is `vidzart-app` (the web editor).

## What Vidzart is

A screen recorder + editor for polished product demos and tutorials (think Cursorful / Screen
Studio). The editor uses the event log recorded here to add smooth zooms that follow clicks, a
smoothed cursor and click effects, then exports an MP4.

**Completely free and local-first.** No accounts, no cloud, no Vidzart servers. Recordings stay on
the user's machine. Distributed **from source** for now (not on the Chrome Web Store).

## Principles

- **Local-first and private.** Nothing is uploaded anywhere. Plain typed text is never logged
  (see the key privacy rule in the spec).
- **Minimal permissions.** Ask for the least access that works. Every permission is justified
  below; adding one requires adding a row to that table.
- **Non-destructive.** The extension only captures raw material (video + events); all editing
  happens in the app.
- **Readable, explained code.** The author is learning extensions and media APIs: comments
  explain *why*, and lessons go into `LEARNINGS.md`.

## Tech stack

Installed versions are pinned in `package.json` / `pnpm-lock.yaml` (scaffolded 2026-10-11).

- **WXT 0.21** (extension framework: file-based entrypoints, manifest generation, dev reload;
  builds with Vite). The manifest is **generated** from `wxt.config.ts` + entrypoint files, so
  there's no hand-written `manifest.json`.
- **React 19.3** for the popup and extension pages (`@wxt-dev/module-react`)
- **TypeScript 5.9** strict (WXT's template pins `^5`; `strict` comes from `.wxt/tsconfig.json`,
  which `wxt prepare` generates and our `tsconfig.json` extends)
- A small zip library for writing `.vidz` (choose at scaffold time, e.g. fflate)
- **pnpm**

## Entrypoints (WXT)

Scaffolded so far: `popup/` (placeholder) and `background.ts` (logs on start). Chrome-only (we
dropped WXT's Firefox scripts, since `tabCapture`/`offscreen` are Chrome APIs). Target layout:

```
entrypoints/
  popup/           Record / Stop button, status
  background.ts    service worker: orchestrates recording, holds no important state
  offscreen/       offscreen document: getUserMedia + MediaRecorder, collects chunks + events
  recorder.content.ts  event logger, NOT auto-injected; injected via scripting on Record
  ready/           "Recording ready" extension page: preview, Save .vidz, Open editor
lib/
  vidz/            .vidz types + zip writer (spec below)
  messages.ts      typed message definitions between contexts
```

## Recording flow

1. User clicks the toolbar icon → popup → **Record**. That click is the user gesture that
   grants `activeTab` for the current tab.
2. Background creates the **offscreen document** (`chrome.offscreen.createDocument`, reason
   `USER_MEDIA`). Only one can exist at a time.
3. Background calls `chrome.tabCapture.getMediaStreamId({ targetTabId })` and sends the stream id
   to the offscreen doc.
4. Offscreen doc calls `navigator.mediaDevices.getUserMedia` with
   `chromeMediaSource: "tab"` + that id, starts `MediaRecorder`, and records
   `startedAt = performance.timeOrigin + performance.now()` on the recorder's `start` event.
5. Background injects the event logger with `chrome.scripting.executeScript` into that tab.
   It timestamps events with the same formula and **sends them in batches (~every second)** to the
   extension, so a page navigation loses at most the last batch.
6. **Stop** → stop recorder + logger → build `events.json`, `project.json` (defaults),
   `manifest.json` → zip into `.vidz` → store in extension IndexedDB → open the **ready** page.
7. Ready page: **Save .vidz** (a normal `<a download>`, no `downloads` permission needed) and
   **Open editor** (opens the app URL; v1 the user then opens the saved file there).
   Later: direct handoff via `externally_connectable` messaging.

### MV3 gotchas to keep in mind

- **The service worker can be killed at any time** (≈30s idle). Never keep recording state in SW
  globals. The offscreen document owns the recording; the SW asks it for status.
- **Capturing a tab mutes it for the user.** Route the captured audio back to the speakers in
  the offscreen doc (`AudioContext` → `createMediaStreamSource(stream)` → `destination`).
- **Navigation:** `activeTab` access and the injected script are lost when the tab navigates to
  another page. v1: the video keeps recording but events stop, so the ready page warns about it.
  Re-injecting would need broader permissions; decide later.
- **Cross-origin iframes:** the logger runs in the top frame only, so events inside them are
  not captured.
- Show recording status with `chrome.action.setBadgeText` (no permission needed).

## Permissions

| Permission | Why we need it |
| --- | --- |
| `activeTab` | Temporary access to **only the tab the user clicked us on**, only after that click. Replaces broad host permissions. |
| `scripting` | Inject the event-logger content script into that tab when the user presses Record (`chrome.scripting.executeScript`). Works with the `activeTab` grant. |
| `tabCapture` | Get a media stream id for the tab's video + audio (`chrome.tabCapture.getMediaStreamId`). |
| `offscreen` | Create the offscreen document. MV3 service workers have no DOM/`MediaRecorder`, so recording must run in a hidden document. |

Today the manifest requests **none** of these. Each one is added in `wxt.config.ts` only when the
code that uses it lands (Phase 4).

**Deliberately not requested:**

- **Host permissions / `<all_urls>`:** `activeTab` + `scripting` covers it, with no install
  warning about "read and change all your data".
- **`downloads`:** saving happens via `<a download>` on our own extension page.
- **`tabs`:** we only need the active tab id, which the popup/`activeTab` gives us.
- **`storage` / `unlimitedStorage`:** extension IndexedDB works without `storage`. Add
  `unlimitedStorage` only if long recordings actually hit quota (and document it here).

<!-- BEGIN VIDZ SPEC -->
## Project file format (`.vidz`)

> **This spec is duplicated in 3 files** (`vidzart/CLAUDE.md`, `vidzart-app/CLAUDE.md`,
> `vidzart-extension/CLAUDE.md`). **If you change it, update all three and keep them identical.**
> Everything between the `BEGIN VIDZ SPEC` / `END VIDZ SPEC` markers is the shared part.

A `.vidz` file is a **zip archive** that holds one project. The original recording inside it is
never modified. Edits live in `project.json`, and the final video is rendered from
`video + events + project` at export time.

### Archive layout

```
my-demo.vidz  (zip)
├── manifest.json     required. Read this first.
├── video.webm        required. The raw recording (or video.mp4 for imported files)
├── events.json       optional. Cursor/click log; missing for plain imported videos
├── project.json      required. Edit settings + segments
└── assets/           optional. e.g. a custom background image
```

- Store the video entry **without compression** (zip "STORE" method). It's already compressed, so
  deflating it costs CPU and gains nothing.
- File names inside the zip are fixed by `manifest.json`; readers must not guess them.

### Common rules (all JSON files)

- Every JSON file has an integer `version` field. Current version for all files: **1**.
- **Times** are milliseconds (numbers, may be fractional) on the **source** timeline, i.e. the
  original recording, before trims/speed changes.
- A **reader** migrates older versions forward through a chain of `migrateVnToVn+1` functions and
  **refuses** files with a newer version than it understands (with a clear "update Vidzart"
  message).
- **Adding** an optional field that has a default value does **not** bump the version.
  Renaming/removing fields or changing their meaning **does**.
- A writer preserves unknown fields it read, so an older app doesn't destroy newer data.

### `manifest.json`

```ts
interface VidzManifest {
  format: "vidzart-project"; // magic string: lets us reject random zips early
  version: 1;
  createdAt: string;         // ISO 8601, e.g. "2026-10-11T09:30:00.000Z"
  createdBy: { app: "vidzart-extension" | "vidzart-app"; version: string };
  files: {
    video: string;           // "video.webm" | "video.mp4"
    events?: string;         // "events.json", absent if there is no event log
    project: string;         // "project.json"
  };
}
```

### `events.json`: the input log recorded alongside the video

```ts
interface VidzEvents {
  version: 1;
  viewport: { width: number; height: number; devicePixelRatio: number }; // at recording start
  startedAt: number; // zero point, see "Clock sync" below
  events: VidzEvent[]; // sorted by t ascending
}

type VidzEvent =
  | { t: number; type: "move";   x: number; y: number }
  | { t: number; type: "down";   x: number; y: number; button: 0 | 1 | 2 } // left|middle|right
  | { t: number; type: "up";     x: number; y: number; button: 0 | 1 | 2 }
  | { t: number; type: "click";  x: number; y: number; button: 0 | 1 | 2 }
  | { t: number; type: "scroll"; x: number; y: number; scrollX: number; scrollY: number }
  | { t: number; type: "key";    x: number; y: number; combo: string } // e.g. "Meta+Shift+K"
  | { t: number; type: "resize"; width: number; height: number; devicePixelRatio: number };
```

- `t`: ms since `startedAt` (can be negative for events logged a moment before the recorder
  started; readers drop or clamp those).
- `x`, `y`: **viewport CSS pixels** (`clientX` / `clientY`), not `pageX` / `pageY`. The video shows
  the viewport, so scroll offset must not be baked into cursor positions. For `scroll` and `key`,
  `x`/`y` are the last known pointer position, and `scrollX`/`scrollY` are the page's scroll
  offsets after the scroll.
- `move` events are throttled to at most one per animation frame (~60/s) to keep the file small.
  Smoothing happens in the editor, not at capture time.
- **Key privacy rule:** `key` events are only recorded for **shortcuts that include Ctrl, Meta or
  Alt** (for showing "⌘K"-style badges). Plain typed characters, including Shift+letter, are
  **never** recorded, so passwords and messages typed during a demo never end up in the file.
- `resize` records a viewport change (window resize or browser zoom). It changes the coordinate
  mapping from that moment on.
- Known limitation: events inside cross-origin iframes are not visible to the top-frame logger.

#### Clock sync

The video is recorded in the extension's **offscreen document**, while events come from a
**content script** in the page. Those are two different JS contexts, and each one's
`performance.now()` counts from its own `performance.timeOrigin`, so raw `now()` values can't be
compared.

Mitigation: **both sides timestamp with `performance.timeOrigin + performance.now()`**, a
high-resolution "epoch ms" that is comparable across contexts on the same machine (to within a
few ms).

- The recorder captures that value when `MediaRecorder` fires its `start` event and stores it
  as `events.json.startedAt`. That's the zero point.
- The content script stamps each event with the same formula; on save,
  `t = eventStamp - startedAt`.
- Any small residual offset (encoder latency before the first frame) can be corrected per project
  with `project.json.source.eventsOffsetMs` (default `0`).

#### Coordinate mapping: CSS px → video px

```
sx = videoWidth  / viewport.width      // using the viewport from the latest resize at time t
sy = videoHeight / viewport.height
videoX = x * sx
videoY = y * sy
```

Don't just multiply by `devicePixelRatio`. Tab capture can scale the video (capture constraints,
max resolution), so the ratio has to come from the **actual decoded video size**. Browser zoom
changes CSS px too, which is why `resize` events carry `devicePixelRatio`.

### `project.json`: edit decisions

```ts
interface VidzProject {
  version: 1;
  source: {
    duration: number;        // ms
    width: number;           // decoded video px
    height: number;
    fps: number;             // nominal; recordings are often variable frame rate
    eventsOffsetMs?: number; // default 0, shifts all event times (see Clock sync)
  };
  settings: {
    aspectRatio: "source" | "16:9" | "9:16" | "1:1" | "4:3";
    background:
      | { type: "color"; color: string }                          // CSS color
      | { type: "gradient"; from: string; to: string; angle: number } // angle in degrees
      | { type: "image"; src: string };   // "assets/bg.png" in the zip, or "builtin:<id>"
    padding: number;      // fraction of the output canvas's shorter side, 0–0.5
    cornerRadius: number; // same unit as padding
    shadow: { enabled: boolean; blur: number; opacity: number; offsetY: number }; // blur/offsetY: same unit as padding
    cursor: { visible: boolean; scale: number; smoothing: number; hideWhenIdleMs?: number }; // smoothing 0–1
    clickEffect: { type: "none" | "ripple" | "pulse"; color: string };
  };
  segments: Segment[];
}

type Segment =
  | { id: string; type: "zoom"; start: number; end: number;
      scale: number;                                  // >= 1, e.g. 2 = 2x
      target: { mode: "fixed"; x: number; y: number } // normalized 0–1 of the source frame
            | { mode: "follow" };                     // follow the cursor from events.json
      easeInMs: number; easeOutMs: number;
      origin?: "manual" | "auto" }                    // auto = generated from events
  | { id: string; type: "trim";  start: number; end: number }  // range is cut out
  | { id: string; type: "speed"; start: number; end: number; rate: number } // 2 = twice as fast
  | { id: string; type: "blur";  start: number; end: number;
      rect: { x: number; y: number; width: number; height: number } }  // normalized 0–1
```

- `start` / `end` are source-timeline ms, `start < end`.
- `zoom`, `trim` and `speed` segments must not overlap others **of the same type**. `blur`
  segments may overlap.
- Positions and sizes are **normalized** (0–1 of the source frame, or a fraction of the output's
  shorter side), so a project renders the same at 720p and 4K.
- `id` is a random unique string (e.g. `crypto.randomUUID()`).
- **Output time ≠ source time.** Trims remove time and speed segments stretch it. The editor
  keeps one mapping function `sourceToOutput(t)` / `outputToSource(t)` and everything (timeline,
  preview, export) goes through it.
<!-- END VIDZ SPEC -->

## Commands

```sh
pnpm install      # also runs `wxt prepare` (generates .wxt/ types + tsconfig)
pnpm dev          # opens a Chrome window with the extension loaded, auto-reloads on save
pnpm build        # production build → .output/chrome-mv3/ (load this with "Load unpacked")
pnpm zip          # zipped build, handy for sharing
pnpm typecheck    # tsc --noEmit
```

After `pnpm build`, check `.output/chrome-mv3/manifest.json`: the `permissions` must match the
table above, and there must be **no `host_permissions`** and no static `content_scripts`.

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- Small, focused commits with clear messages.
- Non-trivial lessons (MV3 lifecycle, capture quirks, clock sync) → `LEARNINGS.md`.

## Roadmap (this repo)

- [ ] **Phase 4:** record tab + events, save `.vidz`, open the editor.
- [ ] **Phase 5 (support):** make sure the event log has what cursor smoothing / click effects
      need.
- [ ] **Later:** direct handoff to the editor via `externally_connectable`.

**Not planned:** accounts, cloud upload, Chrome Web Store listing (for now: install from source).

**Current phase:** WXT scaffolded (placeholder popup, no permissions). Waits for Phase 4; the
app's Phases 0–3 come first.
