// "Open in editor": hands a recording straight to the Vidzart web app,
// without the user saving and re-opening a file, and without any server.
//
//   ready page                          editor (web app, other origin)
//   window.open(editor?from=extension) ─▶ loads, sees ?from=extension
//                                     ◀── opener.postMessage("editor-ready")
//   win.postMessage({file}) ──────────▶ opens the .vidz like a dropped file
//
// postMessage can carry a File between windows of different origins (it's
// structured-cloned, not JSON), so even a big recording goes across without
// copying it through anything else. We wait for the editor to say it's
// ready because a message posted before its listener exists is simply lost.
// The editor only accepts these messages from chrome-extension:// origins.

export const EDITOR_READY = 'vidzart:editor-ready';
export const OPEN_PROJECT = 'vidzart:open-project';

/** Where the editor lives. Overridable on the ready page (saved per browser). */
export const DEFAULT_EDITOR_URL: string = import.meta.env.WXT_EDITOR_URL ?? 'http://localhost:3000/editor';

const TIMEOUT_MS = 30_000;

export function openInEditor(editorUrl: string, file: File): Promise<void> {
  const url = new URL(editorUrl);
  url.searchParams.set('from', 'extension');
  const win = window.open(url.href, '_blank');
  if (!win) return Promise.reject(new Error('The browser blocked opening the editor tab.'));

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`The editor at ${url.origin} didn't respond. Is it running? You can also save the .vidz and open it there.`));
    }, TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      // Only our editor tab, from the expected origin.
      if (event.source !== win || event.origin !== url.origin) return;
      if ((event.data as { type?: unknown } | null)?.type !== EDITOR_READY) return;
      cleanup();
      win.postMessage({ type: OPEN_PROJECT, file }, url.origin);
      resolve();
    };
    window.addEventListener('message', onMessage);
  });
}
