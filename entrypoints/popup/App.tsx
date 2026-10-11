import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { RecorderStatus, Result, ToBackground } from '@/lib/messages';

const send = (message: ToBackground) => browser.runtime.sendMessage(message);

// The toolbar popup: Record / Stop. Opening it is the user gesture that
// grants activeTab for the current tab, which tab capture and the event
// logger both rely on.
function App() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void send({ to: 'background', type: 'status' }).then((s) => setStatus(s as RecorderStatus));
  }, []);

  const record = async () => {
    setBusy(true);
    setError(null);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      setError('No tab to record.');
      setBusy(false);
      return;
    }
    const result = (await send({ to: 'background', type: 'start', tabId: tab.id, title: tab.title ?? 'Recording' })) as Result;
    if (result.ok) window.close(); // get out of the way; the badge shows REC
    else {
      setError(result.error);
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    await send({ to: 'background', type: 'stop' });
    window.close(); // the "Recording ready" tab opens by itself
  };

  return (
    <main className="popup">
      <h1>Vidzart</h1>
      {status === null && <p className="muted">…</p>}
      {status?.state === 'idle' && (
        <>
          <p className="muted">Records this tab with its cursor and clicks. Everything stays on your device.</p>
          <button className="primary" disabled={busy} onClick={() => void record()}>
            <span className="dot" /> {busy ? 'Starting…' : 'Record this tab'}
          </button>
        </>
      )}
      {status?.state === 'recording' && (
        <>
          <p>
            Recording · <Elapsed since={status.startedAt} />
          </p>
          <button className="primary" disabled={busy} onClick={() => void stop()}>
            <span className="square" /> Stop
          </button>
        </>
      )}
      {(status?.state === 'starting' || status?.state === 'saving') && (
        <p className="muted">{status.state === 'starting' ? 'Starting…' : 'Saving the recording…'}</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Shortcut: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> starts and stops.
      </p>
      <p className="hint">
        Free and open source.{' '}
        <a href="https://buymeacoffee.com/riteshs" target="_blank" rel="noreferrer">
          Buy me a coffee ☕
        </a>
      </p>
    </main>
  );
}

/** A ticking m:ss timer. Local state is fine here: it changes once a second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => performance.timeOrigin + performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.timeOrigin + performance.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="time">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

export default App;
