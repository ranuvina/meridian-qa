const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function getSession() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('meridian.session');
  return raw ? JSON.parse(raw) : null;
}

export function setSession(session: any) {
  localStorage.setItem('meridian.session', JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem('meridian.session');
}

export async function api(path: string, options: RequestInit = {}) {
  const session = getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (session?.accessToken) headers['Authorization'] = `Bearer ${session.accessToken}`;
  if (session?.activeTenantId) headers['x-tenant-id'] = session.activeTenantId;

  const res = await fetch(`${BASE}/api/v1${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || res.statusText), { status: res.status });
  }
  if (res.headers.get('content-type')?.includes('text/csv')) return res.text();
  return res.json();
}
