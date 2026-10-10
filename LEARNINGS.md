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
