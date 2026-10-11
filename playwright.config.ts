import { defineConfig } from '@playwright/test';

// End-to-end tests load the real extension build into Chromium. The
// `test:e2e` script builds the e2e variant first (see wxt.config.ts → E2E).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
