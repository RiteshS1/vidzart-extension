# Vidzart (Chrome extension)

The **recorder** for Vidzart, a free, local-first screen recorder and editor for polished product
demos and tutorials. The extension records the current tab and, at the same time, logs your
cursor movements and clicks. It saves both as a `.vidz` project that you open in the Vidzart
editor (companion repo **[vidzart-app](https://github.com/RiteshS1/vidzart-app)**), which uses the click log to add smooth automatic zooms
and cursor effects.

> **Status:** alpha. Recording, the cursor/click log, `.vidz` export and "Open in editor" work.

## How to use

1. Open the tab you want to record and click the Vidzart icon → **Record this tab**
   (or press **Alt+Shift+R**). The icon shows a red **REC** badge.
2. Do your demo. Tab audio is recorded too, and you still hear it.
3. Click the icon → **Stop** (or Alt+Shift+R again). A **Recording ready** tab opens with a
   preview and:
   - **Open in editor**: opens the Vidzart editor with the recording already loaded. The editor
     address defaults to `http://localhost:3000/editor` (the app's `pnpm dev`); change it under
     "Editor address" on that page.
   - **Save .vidz**: the project file (video + cursor/click log) to open in the editor later.
   - **Download video only**: just the raw WebM.

The extension keeps your 5 newest recordings until you save or delete them. Browser pages
(`chrome://…`, the Chrome Web Store) can't be recorded, and pages where the cursor can't be
tracked are recorded without it (no auto zoom).

## Privacy

- Recordings stay on your machine. Nothing is uploaded.
- The extension only gets access to the tab you click it on, and only after you click it
  (`activeTab`). No "read and change all your data on all websites" permission. Permissions:
  `activeTab`, `scripting`, `tabCapture`, `offscreen`; why each one is needed is in
  [CLAUDE.md](CLAUDE.md#permissions).
- Typed text is never logged. Only shortcuts with Ctrl/Cmd/Alt are recorded (to show
  shortcut badges in the video).

## Install from source

Vidzart isn't on the Chrome Web Store, so you build and load it yourself:

1. Install [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).
2. Clone this repo and install dependencies:
   ```sh
   git clone https://github.com/RiteshS1/vidzart-extension.git
   cd vidzart-extension
   pnpm install
   ```
3. Build it:
   ```sh
   pnpm build
   ```
   This creates the unpacked extension in `.output/chrome-mv3/`.
4. Open `chrome://extensions` in Chrome.
5. Turn on **Developer mode** (top right).
6. Click **Load unpacked** and select the `.output/chrome-mv3/` folder.
7. Pin Vidzart from the puzzle-piece menu so the Record button is one click away.

To update: `git pull`, `pnpm build`, then click the reload icon on the Vidzart card in
`chrome://extensions`.

To point "Open in editor" somewhere else by default, build with
`WXT_EDITOR_URL=https://your-host/editor pnpm build`.

For development, `pnpm dev` opens a separate Chrome window with the extension loaded and
auto-reloading. It keeps its own profile in `.wxt/chrome-data/`, and its dev server runs on port
3010, so it doesn't clash with the web app on 3000.

Tests: `pnpm test` (unit) and `pnpm test:e2e` (records real tabs in Playwright's Chromium; run
`pnpm exec playwright install chromium` once).

## Support

Vidzart is completely free. If you find it helpful, you can [buy me a coffee ☕](https://buymeacoffee.com/riteshs).

## License

[MIT](LICENSE)
