// Code inside page.evaluate() runs in extension pages, where `chrome` exists.
// Typed like WXT's `browser` (which is chrome in Chrome).
declare const chrome: typeof import('wxt/browser').browser;
