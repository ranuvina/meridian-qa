'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, setSession, clearSession } from '../../lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setLocal] = useState<any>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) router.replace('/login');
    else setLocal(s);
  }, [router]);

  if (!session) return <div className="container">Loading…</div>;

  function switchTenant(id: string) {
    const next = { ...session, activeTenantId: id };
    setSession(next);
    setLocal(next);
    router.refresh();
  }

  return (
    <>
      <nav>
        <strong>Meridian</strong>
        <Link href="/dashboard">Overview</Link>
        <Link href="/dashboard/keys">API keys</Link>
        <Link href="/dashboard/usage">Usage</Link>
        <Link href="/dashboard/members">Members</Link>
        <Link href="/dashboard/billing">Billing</Link>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={session.activeTenantId}
            onChange={(e) => switchTenant(e.target.value)}
            style={{ width: 200 }}
          >
            {session.tenants.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
            ))}
          </select>
          <button className="secondary" onClick={() => { clearSession(); router.push('/login'); }}>
            Sign out
          </button>
        </div>
      </nav>
      <div className="container">{children}</div>
    </>
  );
}
