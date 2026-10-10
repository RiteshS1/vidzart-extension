import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vidzart Recorder',
    description:
      'Record a tab with cursor and click data for the Vidzart editor. Local-only, nothing is uploaded.',
    // Permissions are added only when the code that needs them lands, each
    // with a row in CLAUDE.md → Permissions explaining why. Phase 4 adds
    // activeTab, scripting, tabCapture and offscreen.
    permissions: [],
  },
  dev: {
    server: {
      // WXT's dev server (HMR + extension reload) defaults to the first free
      // port from 3000, which collides with the Next.js app on :3000. Next
      // binds *:3000 and WXT then binds [::1]:3000, so the browser's
      // "localhost:3000" silently hits WXT instead of the app. Pin our own
      // port and fail loudly if it's taken.
      port: 3010,
      strictPort: true,
    },
  },
  webExt: {
    // `pnpm dev` launches a separate Chrome. By default it gets a brand-new
    // temporary profile every run (no logins, no settings). Keeping the
    // profile in .wxt/ (gitignored) lets sign-ins on sites you record survive
    // between dev sessions.
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'],
  },
});
