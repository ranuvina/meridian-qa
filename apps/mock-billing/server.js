import express from 'express';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

const charges = new Map();

const failureRate = Number(process.env.FAILURE_RATE || 0);
const latencyMs = Number(process.env.LATENCY_MS || 0);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

app.get('/health', (_req, res) => res.json({ status: 'ok', charges: charges.size }));

app.post('/charges', async (req, res) => {
  if (latencyMs) await delay(latencyMs);

  if (Math.random() < failureRate) {
    return res.status(503).json({ error: 'provider_unavailable' });
  }

  const { tenantId, period, amount, quantity } = req.body || {};
  if (!tenantId || !period) {
    return res.status(400).json({ error: 'tenantId and period required' });
  }

  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey && charges.has(idempotencyKey)) {
    return res.status(200).json(charges.get(idempotencyKey));
  }

  const charge = {
    id: 'ch_' + randomUUID().slice(0, 12),
    tenantId,
    period,
    amount,
    quantity,
    createdAt: new Date().toISOString(),
  };

  charges.set(charge.id, charge);
  if (idempotencyKey) charges.set(idempotencyKey, charge);

  res.status(201).json(charge);
});

// Charges are stored under both their id and their Idempotency-Key; list each charge once.
app.get('/charges', (req, res) => {
  const unique = [...new Map([...charges.values()].map((c) => [c.id, c])).values()];
  const { tenantId } = req.query;
  res.json(tenantId ? unique.filter((c) => c.tenantId === tenantId) : unique);
});

app.post('/_admin/reset', (_req, res) => {
  charges.clear();
  res.json({ ok: true });
});


// --- webhook receiver -------------------------------------------------------
const received = [];

// `/_webhook/:channel` lets parallel tests use isolated receivers.
app.post(['/_webhook', '/_webhook/:channel'], async (req, res) => {
  // Per-request overrides (?delayMs=, ?status=) let parallel tests simulate slow or failing
  // receivers without changing the container's global settings.
  const receiverLatency = Number(req.query.delayMs ?? process.env.WEBHOOK_LATENCY_MS ?? 0);
  if (receiverLatency) await delay(receiverLatency);

  const event = req.body || {};
  received.push({
    id: event.id,
    type: event.type,
    channel: req.params.channel || null,
    data: event.data,
    rawBody: JSON.stringify(event),
    signature: req.get('X-Meridian-Signature'),
    receivedAt: new Date().toISOString(),
  });

  if (req.query.status) {
    return res.status(Number(req.query.status)).json({ forced: true });
  }
  if (Number(process.env.WEBHOOK_FAILURE_RATE || 0) > Math.random()) {
    return res.status(500).json({ error: 'receiver_error' });
  }
  res.status(200).json({ ok: true });
});

app.get('/_webhook/received', (req, res) => {
  const { channel } = req.query;
  res.json(channel ? received.filter((r) => r.channel === channel) : received);
});

app.post('/_webhook/reset', (_req, res) => {
  received.length = 0;
  res.json({ ok: true });
});

app.listen(4010, '0.0.0.0', () => console.log('mock-billing on :4010'));
