# Learnings

A log of bugs I hit and what I learned, especially the non-obvious stuff (media timing,
coordinate mapping, encoding, browser/extension quirks). Newest entries at the top.

## Template

```md
### YYYY-MM-DD: Short title
- **Symptom:** what I saw
- **Cause:** what was actually going on
- **Fix:** what I changed (commit hash if useful)
- **What I learned:** the general lesson, in my own words
- **Links:** docs, issues, articles
```

## Log

### 2026-10-11: Every recording came out with "no cursor data"
- **Symptom:** the first e2e test recorded a page, clicked three buttons, and the ready page said
  "no cursor data": `events.json` was missing entirely.
- **Cause:** the logger sent its first batch (which carried the viewport) immediately on
  injection. But the logger is injected *before* the offscreen document exists, so that message
  went to nobody, and without a viewport the recorder dropped the whole event log.
- **Fix:** the background reads the viewport itself (`executeScript` with a `func`) and passes
  it with the start command; the logger only sends from its first 1s tick on.
- **What I learned:** `runtime.sendMessage` to a context that doesn't exist yet doesn't queue,
  it just disappears (the promise rejects, and we were swallowing that). In a multi-context
  extension, write down which context exists when, and don't put must-arrive data in
  fire-and-forget messages.

### 2026-10-11: Testing tab capture without clicking the toolbar icon
- **Symptom:** from a test, `tabCapture.getMediaStreamId` failed with "Extension has not been
  invoked for the current page (see activeTab permission). Chrome pages cannot be captured."
- **Cause:** tab capture needs the user to have *invoked* the extension on that tab (icon click
  or command), and automation can't click browser UI. Also: that one error message covers both
  "not invoked" and "chrome:// page", so the code can't tell them apart.
- **Fix:** tests launch Chromium with `--allowlisted-extension-id=<id>` (the id of an unpacked
  extension is derived from its path, so a first launch reads it from the service worker URL),
  and a separate e2e build adds `http://localhost/*` host access for injecting the logger.
  Branded Chrome ignores `--load-extension` since v137, so tests use Playwright's Chromium.
- **What I learned:** keep test-only capabilities in a separate build output so they can never
  ship; verify by reading the production `manifest.json`.

### 2026-10-11: Handing a big file from an extension page to a website, serverless
- **Symptom:** "Open in editor" needs to give a possibly huge `.vidz` to the web app on another
  origin. `runtime.sendMessage` / `externally_connectable` are JSON-only.
- **Fix:** the ready page `window.open`s the editor, the editor posts "ready" to
  `window.opener`, and the ready page posts `{ file }` back. `postMessage` structured-clones a
  `File` across origins without reading it into a string. The editor checks `event.source ===
  opener` and a `chrome-extension://` origin.
- **What I learned:** wait for a "ready" message before posting: a message sent before the
  other side has a listener is simply lost.

### 2026-10-11: Shortcut logging and AltGr
- **Cause:** on many European keyboard layouts, AltGr is how you *type* `@`, `€`, `{`, and the
  browser reports it as Ctrl+Alt. A "has Ctrl or Alt → it's a shortcut" rule would log typed
  characters, breaking the privacy rule.
- **Fix:** `getModifierState('AltGraph')` → treat as typing. Letters/digits are named from
  `event.code` because macOS Alt+K gives `event.key === "˚"`.
- **What I learned:** keyboard input is layout-dependent; `key` is the produced character,
  `code` the physical key.

### 2026-10-11: Two dev servers on "port 3000" at the same time
- **Symptom:** with both `pnpm dev`s running, `http://localhost:3000` showed a Chrome error page
  instead of the Vidzart app. WXT only printed a mild warning: "Port 3000 is in use on a wildcard
  address, but localhost:3000 is available".
- **Cause:** Next.js listened on `*:3000` (all addresses). WXT defaults to "first free port from
  3000" and bound `[::1]:3000` (IPv6 loopback only), which the OS allows. Chrome resolves
  `localhost` to `::1` first, so it reached WXT.
- **Fix:** `dev.server.port: 3010` with `strictPort: true` in `wxt.config.ts`.
- **What I learned:** "port in use" isn't one thing: a socket is address + port. Two servers can
  share a port on different addresses, and `localhost` may mean IPv6 or IPv4. Pin dev ports per
  project and make them fail loudly. `lsof -nP -iTCP:3000 -sTCP:LISTEN` shows who's listening.
- **Links:** `node_modules/wxt/dist/types.d.mts` (`dev.server`)

### 2026-10-11: The WXT starter's content script would have added a host permission
- **Symptom:** the `react` template ships `entrypoints/content.ts` with
  `matches: ['*://*.google.com/*']`.
- **Cause:** in WXT, a content-script file with `matches` becomes a static `content_scripts`
  entry in the generated manifest, and Chrome treats those match patterns as **host permissions**
  ("Read and change your data on google.com"). That's exactly what our `activeTab` + `scripting`
  design avoids.
- **Fix:** didn't copy it. The event logger will be injected on demand with
  `chrome.scripting.executeScript` after the user clicks Record.
- **What I learned:** with a framework that *generates* the manifest, always read the built
  `.output/chrome-mv3/manifest.json`. Permissions can come from files, not just from the
  `permissions` array.
- **Links:** https://wxt.dev/guide/essentials/entrypoints.html,
  https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
