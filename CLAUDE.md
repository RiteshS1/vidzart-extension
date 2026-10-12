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
- **No zip library:** `lib/vidz/zip.ts` is copied verbatim from vidzart-app (dependency-free,
  native `CompressionStream`). Keep both copies identical.
- **Vitest** (unit tests in `lib/**/*.test.ts`) and **Playwright** (e2e in `e2e/`, bundled Chromium)
- **pnpm**

## Entrypoints (WXT)

Chrome-only (we dropped WXT's Firefox scripts, since `tabCapture`/`offscreen` are Chrome APIs).

```
entrypoints/
  popup/               Record / Stop button + timer (opening it grants activeTab)
  background.ts        service worker: orchestrates recording, keeps NO state in variables
  offscreen/           hidden document: getUserMedia + MediaRecorder; owns all recording state
  recorder.content.ts  event logger; registration: 'runtime', injected via scripting on Record
  ready/               "Recording ready" page: preview, Open in editor, Save .vidz, Delete
lib/
  vidz/                .vidz types, zip writer (copied from the app), buildVidz, toEventsJson
  messages.ts          typed messages between contexts (each names its receiver in `to`)
  recordings.ts        IndexedDB store of finished recordings (keeps the 5 newest)
  handoff.ts           "Open in editor": window.open + postMessage of the .vidz File
  keyCombo.ts          the key privacy rule (shortcuts with Ctrl/Meta/Alt only)
  clock.ts, mimeType.ts, fileName.ts
e2e/                   Playwright: records a real tab with the extension loaded
```

## Recording flow

1. User clicks the toolbar icon → popup → **Record** (or presses **Alt+Shift+R**, the
   `toggle-recording` command). Either one grants `activeTab` for the current tab.
2. Background injects the **event logger** (`scripting.executeScript`) and reads the tab's
   viewport (CSS px + `devicePixelRatio`). If injection fails (chrome:// pages, Web Store), it
   records anyway, without events, and the ready page says so.
3. Background creates the **offscreen document** (reason `USER_MEDIA`; only one can exist), gets
   `tabCapture.getMediaStreamId({ targetTabId })`, and sends the id + viewport + max capture size
   (viewport × DPR, capped at 4K) to it.
4. Offscreen doc: `getUserMedia` with `chromeMediaSource: "tab"` + that id → plays the tab audio
   back (capture mutes the tab) → `MediaRecorder` (WebM/VP9, 1s chunks). `startedAt =
   epochNow()` on the recorder's `start` event.
5. The logger stamps events with `epochNow()` and sends them **straight to the offscreen doc**
   every second (`runtime.sendMessage`; the background ignores them).
6. **Stop** → background asks the logger for its unsent events (`tabs.sendMessage`) and passes
   them with the stop command → offscreen stops the recorder, measures the video size with a
   `<video>` element, converts events to `t = stamp - startedAt`, stores everything in
   IndexedDB, and tells the background → background closes the offscreen doc and opens
   `ready.html#<id>`. Closing the recorded tab also ends and saves the recording.
7. Ready page: builds the `.vidz` up front, then
   - **Open in editor:** opens `<editor>?from=extension`; the editor posts "ready" to its opener
     and receives the `.vidz` File via `postMessage` (structured clone works across origins). The
     editor accepts it only from `chrome-extension://` origins. Editor URL: build-time
     `WXT_EDITOR_URL` (default `https://vidzart.vercel.app/editor`), changeable on the page
     (e.g. `http://localhost:3000/editor` while developing the app).
   - **Save .vidz** / **Download video only:** `<a download>`, no `downloads` permission.

### MV3 gotchas to keep in mind

- **The service worker can be killed at any time** (≈30s idle). Never keep recording state in SW
  globals. The offscreen document owns the recording; the SW asks it for status.
- **Capturing a tab mutes it for the user.** Route the captured audio back to the speakers in
  the offscreen doc (`AudioContext` → `createMediaStreamSource(stream)` → `destination`).
- **Messages are JSON-only:** Blobs can't go through `runtime.sendMessage`, which is why
  recordings go through IndexedDB (shared by all pages of the extension's origin).
- **Order matters:** the logger is injected before the offscreen doc exists, so anything it sends
  immediately is lost. It only sends after its first 1s interval, and the viewport comes from the
  background, not from the logger.
- **Navigation:** the logger dies with the page. On `tabs.onUpdated` → `complete`, the background
  re-injects it. If Chrome has revoked `activeTab` by then, the video keeps recording, cursor
  tracking stops, and the ready page shows a warning with the time.
- **Cross-origin iframes:** the logger runs in the top frame only, so events inside them are
  not captured.
- **Resizing the window mid-recording** changes the capture size; the editor maps coordinates
  with `resize` events, but the video frames change size too. Best avoided in demos.
- Recording status is shown with `chrome.action.setBadgeText` ("REC"; no permission needed).

## Permissions

| Permission | Why we need it |
| --- | --- |
| `activeTab` | Temporary access to **only the tab the user clicked us on**, only after that click. Replaces broad host permissions. |
| `scripting` | Inject the event-logger content script into that tab when the user presses Record (`chrome.scripting.executeScript`). Works with the `activeTab` grant. |
| `tabCapture` | Get a media stream id for the tab's video + audio (`chrome.tabCapture.getMediaStreamId`). |
| `offscreen` | Create the offscreen document. MV3 service workers have no DOM/`MediaRecorder`, so recording must run in a hidden document. |

Also in the manifest (not permissions): `commands.toggle-recording` (Alt+Shift+R).

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
├── video.webm        required. The raw recording: video.webm or video.mp4, whatever
│                     the recorder or the imported file produced
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
    duration: number;        // ms, measured by the writer (see note below)
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
    keystrokes?: { visible: boolean; position: "bottom" | "top" }; // "⌘K" badges from key events; absent = hidden
  };
  segments: Segment[];
  captions?: Captions; // optional (added later without a version bump); absent = none
}

interface Captions {
  visible: boolean;
  language?: string; // BCP 47 tag of the spoken language, e.g. "en"
  style: {
    size: number;                // text height, fraction of the output canvas's shorter side
    position: "bottom" | "top";
  };
  cues: {
    id: string;
    start: number; end: number;  // source-timeline ms, like segments
    text: string;
    words?: { start: number; end: number; text: string }[]; // optional word timings
  }[];                           // sorted by start, non-overlapping
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
  | { id: string; type: "text";  start: number; end: number;
      text: string;                                   // may contain "\n" line breaks
      x: number; y: number;                           // center, normalized 0–1 of the OUTPUT canvas
      style: { font: "sans" | "serif" | "mono" | "rounded";
               size: number;                          // text height, fraction of the output's shorter side
               weight: 400 | 600 | 800;
               color: string;                         // CSS color
               background?: string;                   // CSS color of a box behind the text, if any
               align: "left" | "center" | "right" };
      animation: { in: TextAnimation; out: TextAnimation } }

  | { id: string; type: "shape"; start: number; end: number;
      kind: "arrow" | "rect" | "ellipse" | "spotlight";
      rect: { x: number; y: number; width: number; height: number }; // normalized 0–1 of the SOURCE frame;
                                                      // arrows go from (x, y) to (x + width, y + height),
                                                      // so width/height may be negative
      style: { color: string; stroke: number } }      // stroke: fraction of the output's shorter side

type TextAnimation = "none" | "fade" | "slide-up" | "pop" | "typewriter";
```

- `start` / `end` are source-timeline ms, `start < end`.
- `zoom`, `trim` and `speed` segments must not overlap others **of the same type**. `blur`,
  `text` and `shape` segments may overlap.
- `shape` segments draw themselves on (outlines) or fade in (spotlight dims everything outside
  the rect) over their first ~0.4 s and fade out over the last ~0.25 s; like blur, they're in
  source space and move with zooms.
- `text` positions are in **output** canvas space (they stay put when a zoom moves the camera);
  `blur` rects are in **source** frame space (they stick to the recorded content). Fonts are
  generic families (`sans`, `serif`, `mono`, `rounded`) that each renderer maps to fonts it has.
- Positions and sizes are **normalized** (0–1 of the source frame, or a fraction of the output's
  shorter side), so a project renders the same at 720p and 4K.
- `id` is a random unique string (e.g. `crypto.randomUUID()`).
- `source.duration` must be **measured**, not trusted from the file header: WebM files written by
  `MediaRecorder` may have no duration (older Chrome, other browsers, or a recording cut short
  by a crash; a `<video>` then reports `Infinity`). Chrome 154 does write it, but we don't rely
  on that. The recorder uses its own start/stop times; the editor falls back to demuxing
  (Mediabunny) to find the last frame's timestamp.
- **Captions** live on the source timeline too. Cue parts inside trims aren't shown, and exported
  subtitle files (SRT/VTT) are mapped to output time. Usually produced by on-device speech
  recognition in the editor, then edited by the user.
- **Output time ≠ source time.** Trims remove time and speed segments stretch it. The editor
  keeps one mapping function `sourceToOutput(t)` / `outputToSource(t)` and everything (timeline,
  preview, export) goes through it.
<!-- END VIDZ SPEC -->

## Commands

```sh
pnpm install      # also runs `wxt prepare` (generates .wxt/ types + tsconfig)
pnpm dev          # dev server on :3010 + opens a separate Chrome with the extension loaded
pnpm build        # production build → dist/chrome-mv3/ (load this with "Load unpacked")
pnpm zip          # zipped build, handy for sharing
pnpm typecheck    # tsc --noEmit
pnpm test         # unit tests (Vitest)
pnpm test:e2e     # builds the e2e variant, then records real tabs in Playwright's Chromium
```

**How the e2e tests can record without a click:** automation can't click the toolbar icon, which
is what grants `activeTab`. So `VIDZART_E2E=1` builds a separate copy to `.output/e2e/` with
`host_permissions: ["http://localhost/*"]` (for injecting the logger), and Chromium is launched
with `--allowlisted-extension-id=<id>` (lets `tabCapture` run uninvoked). Branded Google Chrome
ignores `--load-extension` since v137, so these tests use Playwright's bundled Chromium
(`pnpm exec playwright install chromium` once). The shipped build is unaffected.

Round trip with the real editor (opt-in): run the app (`pnpm dev` in vidzart-app), then
`VIDZART_EDITOR_URL=http://localhost:3000/editor pnpm test:e2e`.

After `pnpm build`, check `dist/chrome-mv3/manifest.json`: the `permissions` must match the
table above, and there must be **no `host_permissions`** and no static `content_scripts`.

**Dev mode differs on purpose.** `pnpm dev` builds to `dist/chrome-mv3-dev/`, and WXT adds
`tabs`, `scripting`, `host_permissions: ["http://localhost/*"]`, a CSP allowing
`http://localhost:3010` and an `Alt+R` reload command. Those power hot reload and are never in
the production build. Judge permissions only from the production manifest.

Dev setup details (see `wxt.config.ts`):
- WXT's dev server is pinned to **port 3010** (`strictPort`) because the Next.js app uses 3000.
- The dev Chrome uses a **persistent profile** in `.wxt/chrome-data/` (gitignored), so logins on
  sites you test-record survive restarts. Delete that folder for a clean slate.
- That Chrome is separate from your everyday one. To test in your own Chrome, `pnpm build` and
  use **Load unpacked** (see README).

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- Small, focused commits with clear messages.
- Non-trivial lessons (MV3 lifecycle, capture quirks, clock sync) → `LEARNINGS.md`.

## Roadmap (this repo)

- [x] **Phase 4:** record tab + events, save `.vidz`, open the editor (direct handoff included).
- [x] **Phase 5 (support):** the event log has what cursor smoothing / click effects need
      (moves per frame, down/up for press state and ripples, resize for the cursor's size).
- [ ] **Later:** microphone narration, webcam bubble, re-injecting the logger after
      cross-origin navigation (would need host permissions; undecided).

**Not planned:** accounts, cloud upload, Chrome Web Store listing (for now: install from source).

**Current phase:** Phase 4 done (2026-10-11): recording, event log, ready page, `.vidz`, direct
handoff, e2e tests. Phase 5 (cursor + click effects) is done in the app; Phase 6 (AI) is
app-only.
