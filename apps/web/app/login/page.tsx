'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setSession } from '../../lib/api';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('owner@acme.test');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setError('Login failed');
      return;
    }
    const data = await res.json();
    setSession({ ...data, activeTenantId: data.tenants[0]?.id });
    router.push('/dashboard');
  }

  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 80 }}>
      <div className="card">
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Sign in to Meridian</h1>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="email" style={{ fontSize: 13 }}>Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" style={{ fontSize: 13 }}>Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
        <button onClick={submit}>Sign in</button>
      </div>
    </div>
  );
}
