import { useCallback, useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';

export default function MemoryControls() {
  const [open, setOpen] = useState(false), [status, setStatus] = useState({ configured: false, enabled: false });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [memories, setMemories] = useState(null);
  const [category, setCategory] = useState('subject'), [value, setValue] = useState(''), [confirmClear, setConfirmClear] = useState(false);
  const pending = useRef(null), mounted = useRef(true);
  const call = useCallback(async (route, input) => {
    if (pending.current) return null;
    const abort = new AbortController(); pending.current = abort;
    const timer = setTimeout(() => abort.abort(), 22000); setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/memory/' + route, { method: input ? 'POST' : 'GET', headers: input ? { 'Content-Type': 'application/json' } : undefined, body: input ? JSON.stringify(input) : undefined, signal: abort.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Memory is unavailable. Session chat still works.');
      return mounted.current && pending.current === abort ? result : null;
    } catch (error) { if (mounted.current && pending.current === abort) setNotice(error.name === 'AbortError' ? 'Memory request cancelled. Refresh to check its current state.' : error.message); return null; }
    finally { clearTimeout(timer); if (pending.current === abort) { pending.current = null; if (mounted.current) setBusy(false); } }
  }, []);
  useEffect(() => {
    mounted.current = true;
    call('status').then(result => { if (result && mounted.current) setStatus(result); });
    return () => { mounted.current = false; pending.current?.abort(); pending.current = null; };
  }, [call]);
  const close = useCallback(() => { pending.current?.abort(); pending.current = null; setBusy(false); setOpen(false); setConfirmClear(false); }, []);
  async function consent(enabled) { const result = await call('consent', { enabled }); if (result) { setStatus(result); setNotice(enabled ? 'Memory is on. Only preferences you explicitly save are stored.' : 'Memory is off. Saved preferences are retained for you to view or delete.'); } }
  async function view() { const result = await call('list'); if (result) { setMemories(result.memories); setNotice(''); } }
  async function save(event) { event.preventDefault(); const result = await call('save', { category, value }); if (result) { setValue(''); setNotice(result.notice || (result.duplicate ? 'That preference is already remembered.' : 'Preference remembered.')); setMemories(null); } }
  async function remove(id) { const result = await call('delete', { id }); if (result) { setMemories(current => current.filter(item => item.id !== id)); setNotice('Preference deleted.'); } }
  async function clear() { const result = await call('clear', { confirm: true }); if (result) { setMemories([]); setConfirmClear(false); setNotice('All your remembered preferences were cleared.'); } }
  function openMemory() { setOpen(true); call('status').then(result => { if (result) setStatus(result); }); }
  return <>
    <button type="button" className="text-button memory-open" onClick={openMemory} aria-label="Memory settings"><Icon name="shield" size={13} />Memory {status.enabled ? 'on' : 'off'}</button>
    {open && <Dialog title="What you choose to remember." eyebrow="MEMORY" onClose={close} className="settings-dialog">
      <div className="preferences-content memory-content">
        <label className="preference-row"><span>Enable Memory<small>Recall your chosen preferences across visits and characters.</small></span><input type="checkbox" aria-label="Enable Memory" checked={status.enabled} disabled={busy || !status.configured} onChange={event => consent(event.target.checked)} /></label>
        <p className="voice-engine-note">Memory is optional. Only preferences you save here go to Mem0. Turning it off stops saving and recall; you can still view or delete saved information. Clearing chat leaves these preferences intact.</p>
        {!status.configured && <p role="status" className="voice-notice">Long-term memory is unavailable. Session chat still works.</p>}
        <form className="memory-form" onSubmit={save}>
          <label htmlFor="memory-category">Preference</label><select id="memory-category" value={category} onChange={event => setCategory(event.target.value)} disabled={busy || !status.enabled}><option value="subject">Favorite subject</option><option value="topic">Conversation topic</option><option value="character">Favorite companion</option><option value="language">Response language</option><option value="hobby">Favorite hobby</option></select>
          <label htmlFor="memory-value">What should I remember?</label><input id="memory-value" value={value} onChange={event => setValue(event.target.value)} maxLength={120} placeholder="For example, astronomy" disabled={busy || !status.enabled} />
          <button className="text-button" type="submit" disabled={busy || !status.enabled || !value.trim()}>Remember preference</button>
        </form>
        <div className="memory-actions"><button type="button" className="text-button" disabled={busy || !status.configured} onClick={view}>View remembered information</button><button type="button" className="text-button" disabled={busy || !status.configured} onClick={() => setConfirmClear(true)}>Clear Memory</button></div>
        {confirmClear && <div role="alert" className="memory-confirm"><p>Delete all preferences saved for this browser identity?</p><button type="button" className="text-button" disabled={busy} onClick={clear}>Delete all preferences</button><button type="button" className="text-button" onClick={() => setConfirmClear(false)}>Keep preferences</button></div>}
        {memories && <ul className="memory-list">{memories.length ? memories.map(item => <li key={item.id}><span>{item.text}</span><button type="button" className="text-button" disabled={busy} aria-label={`Delete ${item.text}`} onClick={() => remove(item.id)}>Delete</button></li>) : <li>No remembered preferences.</li>}</ul>}
        {notice && <p className="voice-notice" role="status">{notice}</p>}
      </div>
    </Dialog>}
  </>;
}
