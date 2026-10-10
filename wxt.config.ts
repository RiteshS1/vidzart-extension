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
});
