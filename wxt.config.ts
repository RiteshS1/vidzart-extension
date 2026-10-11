import { defineConfig } from 'wxt';

// `pnpm test:e2e` builds a separate copy with VIDZART_E2E=1. Automated
// browsers can't click the toolbar icon, which is what grants activeTab, so
// that copy instead gets host access to localhost test pages. It's built to
// .output/e2e/ and never shipped; the real build has no host permissions.
const E2E = process.env.VIDZART_E2E === '1';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Vidzart Recorder',
    description:
      'Record a tab with cursor and click data for the Vidzart editor. Local-only, nothing is uploaded.',
    // Every permission has a row in CLAUDE.md → Permissions saying why.
    // Deliberately NO host permissions: activeTab (granted by clicking our
    // icon or using our shortcut) covers the one tab being recorded.
    permissions: ['activeTab', 'scripting', 'tabCapture', 'offscreen'],
    ...(E2E ? { host_permissions: ['http://localhost/*'] } : {}),
    commands: {
      // Start/stop without opening the popup. Using a command also grants
      // activeTab for the current tab, just like clicking the icon.
      'toggle-recording': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Start or stop recording this tab',
      },
    },
  },
  ...(E2E ? { outDir: '.output/e2e' } : {}),
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
