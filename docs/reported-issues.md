# Open support tickets

Unverified reports from customers and internal staff. Some may not be reproducible.

---

**SUP-1043 — Overage charge on an account that was under quota**
Reported by: Success (Northwind Traders)
Customer says they were billed for overage but the dashboard showed them below their monthly
quota at the time. They sent a screenshot. We have not been able to reproduce it manually.

---

**SUP-1051 — Revoked key kept working**
Reported by: On-call engineer
During an incident we revoked a customer's production key. The UI showed it as revoked
immediately, but the customer's traffic kept getting through for a short while afterwards.
Traffic stopped on its own. Nobody is sure why.

---

**SUP-1058 — Usage numbers wrong at month start**
Reported by: Success (Sakura KK)
Customer in Tokyo says the request counts on the 1st of the month do not match their own logs.
They claim requests are showing on the wrong day. Difference is small but consistent.

---

**SUP-1062 — Usage page times out**
Reported by: Success (Northwind Traders)
Their largest account cannot load the usage page at all — it spins and eventually errors.
Smaller accounts are fine. Started after they onboarded their analytics pipeline.

---

**SUP-1067 — Free tier customer far exceeded their rate limit**
Reported by: Platform
Traffic review showed a FREE tenant sustaining well above 100 requests per minute for several
minutes. Rate limiting is configured and appears to work when tested by hand.

---

**SUP-1071 — Duplicate notifications**
Reported by: Customer (Acme Corp)
Customer's webhook receiver occasionally processes the same event twice. Happens more often
when their endpoint is slow.
