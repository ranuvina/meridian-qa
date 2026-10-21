import { UsageService } from './usage.service';

describe('usage: aggregation', () => {
  const fakeDb = (rows: any[]) => ({ query: jest.fn().mockResolvedValue(rows), one: jest.fn() }) as any;

  it('maps grouped rows to per-key usage and totals them', async () => {
    const db = fakeDb([
      { id: 'k1', name: 'Prod', prefix: 'mk_1', requests: 10, errors: 1, avg_latency: 20.5 },
      { id: 'k2', name: 'Idle', prefix: 'mk_2', requests: 0, errors: 0, avg_latency: 0 },
    ]);
    const result = await new UsageService(db).summary('t1', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(result.totalRequests).toBe(10);
    expect(result.keys).toEqual([
      { keyId: 'k1', name: 'Prod', prefix: 'mk_1', requests: 10, errors: 1, avgLatencyMs: 20.5 },
      { keyId: 'k2', name: 'Idle', prefix: 'mk_2', requests: 0, errors: 0, avgLatencyMs: 0 },
    ]);
    expect(db.query).toHaveBeenCalledTimes(1); // DEF-014: one query regardless of key count
  });

  it('renders CSV with a header and one line per event', () => {
    const csv = new UsageService(fakeDb([])).toCsv([
      { created_at: '2026-01-02T03:04:05Z', key_name: 'Prod', route: 'GET /gw/ping', status: 200, latency_ms: 12 },
    ]);
    expect(csv).toBe('timestamp,key_name,route,status,latency_ms\n2026-01-02T03:04:05.000Z,Prod,GET /gw/ping,200,12');
  });

  it.failing('DEF-018: quotes values containing commas', () => {
    const csv = new UsageService(fakeDb([])).toCsv([
      { created_at: '2026-01-02T03:04:05Z', key_name: 'Ops, EU', route: 'GET /gw/ping', status: 200, latency_ms: 12 },
    ]);
    expect(csv.split('\n')[1]).toBe('2026-01-02T03:04:05.000Z,"Ops, EU",GET /gw/ping,200,12');
  });
});
