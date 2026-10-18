import { useState } from 'react';
import { useApp, useSyncStatus } from './context';
import { Sheet, toast } from '../ui/kit';
import { IconCloud, IconCloudOff } from '../ui/icons';
import { parseTimestamp } from '../data/sync';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - parseTimestamp(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** Shows whether changes are saved on this device only, syncing, or synced. */
export function SyncBadge() {
  const st = useSyncStatus();
  const { sync, store } = useApp();
  const [open, setOpen] = useState(false);
  let label: string;
  let cls = '';
  if (st.state === 'syncing') { label = 'Syncing…'; cls = 'syncing pending'; }
  else if (st.failed > 0) { label = 'Sync problem'; cls = 'bad'; }
  else if (st.pending > 0) { label = 'Saved on this device'; cls = 'pending'; }
  else if (st.state === 'offline' || st.state === 'unavailable') { label = 'Offline'; cls = 'pending'; }
  else if (st.state === 'signin') { label = 'Sign in to sync'; cls = 'bad'; }
  else { label = 'Synced'; }

  const failed = store.failedEntries();
  return (
    <>
      <button className={`sync ${cls}`} onClick={() => setOpen(true)} aria-label={`Sync status: ${label}. Details`}>
        <span className="dot" aria-hidden="true" />{label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sync">
        <div className="card">
          <div className="inline" style={{ gap: 12 }}>
            {st.state === 'offline' || st.state === 'unavailable' ? <IconCloudOff /> : <IconCloud />}
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{label}</div>
              <div className="small muted">
                {st.pending > 0 ? `${st.pending} change${st.pending === 1 ? '' : 's'} waiting to upload. ` : 'Everything on this device is saved to your account. '}
                Last synced {ago(st.lastSyncedAt)}.
              </div>
            </div>
          </div>
          {st.message && <p className="small" style={{ marginBottom: 0 }}>{st.message}</p>}
        </div>
        {failed.length > 0 && (
          <div className="mt">
            <p className="small">These changes were refused by the server. They are still on this device.</p>
            <div className="list">
              {failed.map((f) => (
                <div key={f.key} className="row">
                  <div className="row-main">
                    <div className="row-title small">{f.table.replace(/_/g, ' ')}</div>
                    <div className="row-meta">{f.last_error}</div>
                  </div>
                  <button className="btn small secondary" onClick={() => {
                    f.failed = false; f.attempts = 0; f.last_error = null;
                    store.saveQueueEntry(f);
                    void sync.syncNow();
                  }}>Retry</button>
                  <button className="btn small ghost" onClick={async () => {
                    try {
                      await sync.discard(f);
                      toast('Discarded. This device now matches your account.');
                    } catch {
                      toast('Could not reach the server. Try again when online.');
                    }
                  }}>Discard</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="small muted">Your iPhone doesn’t let web apps sync in the background. Syncing happens when the app is open, when you come back to it, and when the connection returns.</p>
        <button className="btn block" onClick={() => void sync.syncNow()} disabled={st.state === 'syncing'}>Sync now</button>
      </Sheet>
    </>
  );
}
