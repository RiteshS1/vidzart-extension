// The MV3 service worker. Chrome can stop it after ~30s of inactivity, so it
// must never hold recording state in variables. In Phase 4 it orchestrates
// recording (see CLAUDE.md → Recording flow); for now it only proves the
// extension loads.
export default defineBackground(() => {
  console.log('Vidzart background started', { id: browser.runtime.id });
});
