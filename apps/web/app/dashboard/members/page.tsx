'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

const ROLES = ['OWNER', 'ADMIN', 'BILLING', 'MEMBER', 'VIEWER'];

export default function Members() {
  const [members, setMembers] = useState<any[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [error, setError] = useState('');

  const load = () => api('/memberships').then(setMembers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function invite() {
    try {
      await api('/memberships/invite', { method: 'POST', body: JSON.stringify({ email, role }) });
      setEmail(''); load();
    } catch (e: any) { setError(e.message); }
  }

  async function changeRole(id: string, next: string) {
    try { await api(`/memberships/${id}`, { method: 'PATCH', body: JSON.stringify({ role: next }) }); load(); }
    catch (e: any) { setError(e.message); }
  }

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Members</h1>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Invite</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 160 }}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={invite}>Invite</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>
                  <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} style={{ width: 140 }}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td>{new Date(m.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
