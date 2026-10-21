'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

export default function Billing() {
  const [preview, setPreview] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/billing/invoice-preview').then(setPreview).catch((e) => setError(e.message));
    api('/billing/events').then(setEvents).catch(() => {});
  }, []);

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1 style={{ fontSize: 22 }}>Billing</h1>
      {preview && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Current period</h2>
          <table>
            <tbody>
              <tr><td>Plan</td><td>{preview.plan}</td></tr>
              <tr><td>Included quota</td><td>{preview.quota.toLocaleString()}</td></tr>
              <tr><td>Used</td><td>{preview.used.toLocaleString()}</td></tr>
              <tr><td>Overage requests</td><td>{preview.overageRequests.toLocaleString()}</td></tr>
              <tr><td>Estimated total</td><td>${preview.total}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Billing events</h2>
        <table>
          <thead><tr><th>Period</th><th>Overage</th><th>Amount</th><th>Provider ref</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.period}</td>
                <td>{Number(e.overage_requests).toLocaleString()}</td>
                <td>${e.amount}</td>
                <td>{e.provider_ref || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
