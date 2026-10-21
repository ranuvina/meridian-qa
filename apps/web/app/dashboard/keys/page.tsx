'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function Keys() {
  const [keys, setKeys] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => api('/keys').then(setKeys).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create() {
    try {
      const key = await api('/keys', { method: 'POST', body: JSON.stringify({ name }) });
      setCreated(key);
      setName('');
      load();
    } catch (e: any) { setError(e.message); }
  }

  async function revoke(id: string) {
    try { await api(`/keys/${id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { setError(e.message); }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>API keys</h1>
        <button onClick={() => setOpen(true)}>Create key</button>
      </div>
      {error && <p className="error">{error}</p>}
      {created && (
        <div className="card">
          <strong>New key — copy it now, it will not be shown again</strong>
          <pre style={{ background: '#f6f7f9', padding: 10, overflow: 'auto' }}>{created.secret}</pre>
        </div>
      )}
      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td><code>{k.prefix}</code></td>
                <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}</td>
                <td>{k.revoked_at ? 'Revoked' : 'Active'}</td>
                <td>{!k.revoked_at && <button className="secondary" onClick={() => revoke(k.id)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, marginTop: 0 }}>Create API key</h2>
            <input
              placeholder="Key name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => { create(); setOpen(false); }}>Create</button>
              <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
