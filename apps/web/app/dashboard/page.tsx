'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function Overview() {
  const [tenant, setTenant] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/tenant').then(setTenant).catch((e) => setError(e.message));
    api('/usage/summary').then(setSummary).catch(() => {});
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!tenant) return <p>Loading…</p>;

  const used = summary?.totalRequests ?? 0;
  const pct = Math.round((used / tenant.limits.monthlyQuota) * 100);

  return (
    <>
      <h1 style={{ fontSize: 22 }}>{tenant.name}</h1>
      {pct > 80 && (
        <div className="rate-warning">
          You have used {pct}% of your monthly quota. Requests beyond the quota are billed as overage.
        </div>
      )}
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Plan</h2>
        <table>
          <tbody>
            <tr><td>Tier</td><td>{tenant.plan}</td></tr>
            <tr><td>Rate limit</td><td>{tenant.limits.rateLimitPerMinute} req/min</td></tr>
            <tr><td>Monthly quota</td><td>{tenant.limits.monthlyQuota.toLocaleString()}</td></tr>
            <tr><td>Timezone</td><td>{tenant.timezone}</td></tr>
            <tr><td>Requests (30d)</td><td>{used.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
