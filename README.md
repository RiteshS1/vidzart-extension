# Vidzart (Chrome extension)

The **recorder** for Vidzart, a free, local-first screen recorder and editor for polished product
demos and tutorials. The extension records the current tab and, at the same time, logs your
cursor movements and clicks. It saves both as a `.vidz` project that you open in the Vidzart
editor (companion repo **vidzart-app**), which uses the click log to add smooth automatic zooms
and cursor effects.

> **Status:** pre-alpha. The extension skeleton builds and loads, but recording isn't implemented yet.

## Privacy

- Recordings stay on your machine. Nothing is uploaded.
- The extension only gets access to the tab you click it on, and only after you click it
  (`activeTab`). No "read and change all your data on all websites" permission.
- Typed text is never logged. Only shortcuts with Ctrl/Cmd/Alt are recorded (to show
  shortcut badges in the video).

## Install from source

Vidzart isn't on the Chrome Web Store, so you build and load it yourself:

1. Install [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io).
2. Clone this repo and install dependencies:
   ```sh
   git clone <this-repo-url> vidzart-extension
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

For development, `pnpm dev` opens a separate Chrome window with the extension loaded and
auto-reloading. It keeps its own profile in `.wxt/chrome-data/`, and its dev server runs on port
3010, so it doesn't clash with the web app on 3000.

## Support

Vidzart is completely free. If you find it helpful, a "Buy me a coffee" link is coming.

## License

[MIT](LICENSE)
