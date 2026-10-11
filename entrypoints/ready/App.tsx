// "Recording ready": opened by the background once a recording is stored.
// The URL hash says which one (#<id>), or carries an error (#error=…).

import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { recordingFileName } from '@/lib/fileName';
import { DEFAULT_EDITOR_URL, openInEditor } from '@/lib/handoff';
import { deleteRecording, getRecording, listRecordings, type StoredRecording } from '@/lib/recordings';
import { buildVidz, videoNameFor } from '@/lib/vidz/build';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }
  | { kind: 'ready'; recording: StoredRecording };

function readHash(): { id: string } | { error: string } | null {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash) return null;
  if (hash.startsWith('error=')) return { error: hash.slice('error='.length) };
  return { id: hash };
}

export default function App() {
  const [hash, setHash] = useState(readHash);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [recent, setRecent] = useState<StoredRecording[]>([]);

  useEffect(() => {
    const onHash = () => setHash(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const all = await listRecordings().catch(() => []);
      if (!live) return;
      setRecent(all);
      if (hash && 'error' in hash) setLoad({ kind: 'error', message: hash.error });
      else {
        // No id: show the newest recording, if any.
        const recording = hash ? await getRecording(hash.id) : all[0];
        if (live) setLoad(recording ? { kind: 'ready', recording } : { kind: 'missing' });
      }
    })();
    return () => {
      live = false;
    };
  }, [hash]);

  return (
    <div className="page">
      <header>
        <strong>Vidzart</strong>
      </header>
      <main>
        {load.kind === 'loading' && <p className="muted">Loading…</p>}
        {load.kind === 'error' && (
          <section className="card">
            <h1>Recording failed</h1>
            <p className="error" role="alert">
              {load.message}
            </p>
          </section>
        )}
        {load.kind === 'missing' && (
          <section className="card">
            <h1>No recording here</h1>
            <p className="muted">It may have been deleted. Only the 5 newest recordings are kept.</p>
          </section>
        )}
        {load.kind === 'ready' && (
          <Ready
            key={load.recording.id}
            recording={load.recording}
            onDeleted={() => {
              setRecent((list) => list.filter((r) => r.id !== load.recording.id));
              setLoad({ kind: 'missing' });
            }}
          />
        )}
        {recent.length > 1 && (
          <section className="recent">
            <h2>Recent recordings</h2>
            <ul>
              {recent.map((r) => (
                <li key={r.id}>
                  <a href={`#${r.id}`}>{r.title}</a>{' '}
                  <span className="muted">
                    {new Date(r.createdAt).toLocaleString()} · {formatDuration(r.durationMs)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function Ready({ recording, onDeleted }: { recording: StoredRecording; onDeleted: () => void }) {
  const baseName = useMemo(() => recordingFileName(recording.title, new Date(recording.createdAt)), [recording]);
  const [vidz, setVidz] = useState<File | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ state: 'idle' | 'opening' | 'done' } | { state: 'error'; message: string }>({
    state: 'idle',
  });
  const [editorUrl, setEditorUrl] = useState(() => {
    try {
      return localStorage.getItem('editorUrl') || DEFAULT_EDITOR_URL;
    } catch {
      return DEFAULT_EDITOR_URL;
    }
  });

  // Object URLs for the preview and the downloads, freed when we leave.
  const videoUrl = useMemo(() => URL.createObjectURL(recording.video), [recording]);
  useEffect(() => () => URL.revokeObjectURL(videoUrl), [videoUrl]);
  const vidzUrl = useMemo(() => (vidz ? URL.createObjectURL(vidz) : null), [vidz]);
  useEffect(() => () => (vidzUrl ? URL.revokeObjectURL(vidzUrl) : undefined), [vidzUrl]);

  // Build the .vidz once, up front: a download link needs its URL before
  // the click. It mostly references the stored video, so it's cheap.
  useEffect(() => {
    let live = true;
    buildVidz(recording, browser.runtime.getManifest().version).then(
      (blob) => live && setVidz(new File([blob], `${baseName}.vidz`, { type: 'application/zip' })),
      (error: unknown) => live && setBuildError(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [recording, baseName]);

  const openEditor = async () => {
    if (!vidz) return;
    setHandoff({ state: 'opening' });
    try {
      await openInEditor(editorUrl, vidz);
      setHandoff({ state: 'done' });
    } catch (error) {
      setHandoff({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const clicks = recording.events?.events.filter((e) => e.type === 'click').length ?? 0;
  const videoExt = videoNameFor(recording.mimeType).split('.')[1];

  return (
    <section className="card">
      <h1>Recording ready</h1>
      <p className="muted" data-testid="recording-title">
        {recording.title}
      </p>
      <video src={videoUrl} controls playsInline className="preview" data-testid="recording-preview" />
      <p className="facts" data-testid="recording-facts">
        {formatDuration(recording.durationMs)} · {recording.width}×{recording.height} ·{' '}
        {(recording.video.size / 1_000_000).toFixed(1)} MB ·{' '}
        {recording.events ? `${clicks} click${clicks === 1 ? '' : 's'} tracked` : 'no cursor data'}
      </p>
      {recording.warnings.map((warning) => (
        <p key={warning} className="warning">
          {warning}
        </p>
      ))}

      <div className="actions">
        <button className="primary" disabled={!vidz || handoff.state === 'opening'} onClick={() => void openEditor()}>
          {handoff.state === 'opening' ? 'Opening the editor…' : 'Open in editor'}
        </button>
        {vidzUrl ? (
          <a className="button" href={vidzUrl} download={`${baseName}.vidz`}>
            Save .vidz
          </a>
        ) : (
          <span className="button disabled">{buildError ? 'Save failed' : 'Preparing…'}</span>
        )}
        <a className="button" href={videoUrl} download={`${baseName}.${videoExt}`}>
          Download video only
        </a>
        <button
          className="button danger"
          onClick={() => void deleteRecording(recording.id).then(onDeleted)}
        >
          Delete
        </button>
      </div>
      {handoff.state === 'done' && <p className="muted">Opened in the editor tab.</p>}
      {handoff.state === 'error' && (
        <p className="error" role="alert">
          {handoff.message}
        </p>
      )}
      {buildError && <p className="error">Couldn't build the .vidz file: {buildError}</p>}
      <p className="muted small">
        The .vidz holds the video, the cursor/click log and default edit settings. It stays on this computer until you
        save it; Vidzart keeps your 5 newest recordings here.
      </p>

      <details className="settings">
        <summary>Editor address</summary>
        <label>
          Where "Open in editor" goes (e.g. your local <code>pnpm dev</code> or wherever you host the app):
          <input
            type="url"
            value={editorUrl}
            onChange={(event) => {
              setEditorUrl(event.target.value);
              try {
                localStorage.setItem('editorUrl', event.target.value);
              } catch {
                // storage unavailable: the setting just won't persist
              }
            }}
          />
        </label>
      </details>
    </section>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
