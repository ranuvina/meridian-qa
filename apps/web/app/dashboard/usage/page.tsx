'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function Usage() {
  const [summary, setSummary] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/usage/summary').then(setSummary).catch((e) => setError(e.message));
    api('/usage/daily').then(setDaily).catch(() => {});
  }, []);

  async function download() {
    const csv = await api('/usage/export');
    const blob = new Blob([csv as any], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'usage.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22 }}>Usage</h1>
        <button onClick={download}>Export CSV</button>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>By key (last 30 days)</h2>
        <table>
          <thead><tr><th>Key</th><th>Requests</th><th>Errors</th><th>Avg latency</th></tr></thead>
          <tbody>
            {summary?.keys?.map((k: any) => (
              <tr key={k.keyId}>
                <td>{k.name} <code style={{ color: '#667085' }}>{k.prefix}</code></td>
                <td>{k.requests.toLocaleString()}</td>
                <td>{k.errors.toLocaleString()}</td>
                <td>{Math.round(k.avgLatencyMs)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Daily</h2>
        <table>
          <thead><tr><th>Day</th><th>Requests</th></tr></thead>
          <tbody>
            {daily.map((d: any) => (
              <tr key={d.day}>
                <td>{new Date(d.day).toLocaleDateString()}</td>
                <td>{Number(d.requests).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
