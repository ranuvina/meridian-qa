import { BillingService, currentPeriod, idempotencyKeyFor } from './billing.service';

describe('billing: arithmetic and identifiers', () => {
  it('formats the UTC billing period', () => {
    expect(currentPeriod(new Date('2026-03-31T23:59:59Z'))).toBe('2026-03');
    expect(currentPeriod(new Date('2026-04-01T00:00:00Z'))).toBe('2026-04');
  });

  it('derives a stable idempotency key per billing event', () => {
    expect(idempotencyKeyFor('abc')).toBe(idempotencyKeyFor('abc'));
    expect(idempotencyKeyFor('abc')).not.toBe(idempotencyKeyFor('abd'));
  });

  it('previews the invoice from usage this month', async () => {
    const db = {
      one: jest
        .fn()
        .mockResolvedValueOnce({ plan: 'GROWTH' })
        .mockResolvedValueOnce({ used: '501000' }),
    } as any;
    const preview = await new BillingService(db).previewInvoice('t1');
    expect(preview).toEqual({
      plan: 'GROWTH',
      quota: 500_000,
      used: 501_000,
      overageRequests: 1_000,
      overageAmount: 1,
      total: 1,
    });
  });
});
