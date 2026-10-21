import { expect, login, seedKeyWithUsage, seedTenant, test } from './fixtures';

test.describe('Critical dashboard journeys', () => {
  test('sign in and see the tenant overview', async ({ page }) => {
    const owner = await seedTenant({ plan: 'GROWTH' });
    await login(page, owner);
    await expect(page.getByRole('heading', { name: owner.tenantName })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'GROWTH' })).toBeVisible();
    await expect(page.getByText('1000 req/min')).toBeVisible();
  });

  test('wrong password is rejected', async ({ page }) => {
    const owner = await seedTenant();
    await page.goto('/login');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Login failed')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('API key lifecycle: create in the UI, call the gateway, revoke, gateway refuses', async ({ page, request }) => {
    const owner = await seedTenant({ plan: 'GROWTH' });
    await login(page, owner);
    await page.getByRole('link', { name: 'API keys' }).click();

    const name = `journey-${Date.now()}`;
    await page.getByRole('button', { name: 'Create key' }).click();
    await page.getByPlaceholder('Key name').fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const secret = (await page.locator('pre').innerText()).trim();
    expect(secret).toMatch(/^mk_[0-9a-f]+\.[0-9a-f]+$/);

    const ok = await request.get('/api/v1/gw/ping', { headers: { 'x-api-key': secret } });
    expect(ok.status()).toBe(200);

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row.getByRole('cell', { name: 'Active' })).toBeVisible();
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row.getByRole('cell', { name: 'Revoked' })).toBeVisible();

    const refused = await request.get('/api/v1/gw/ping', { headers: { 'x-api-key': secret } });
    expect(refused.status()).toBe(401);
  });

  test('invite a member and see them listed', async ({ page }) => {
    const owner = await seedTenant();
    await login(page, owner);
    await page.getByRole('link', { name: 'Members' }).click();

    const email = `invitee-${Date.now()}@e2e.test`;
    await page.getByPlaceholder('email@example.com').fill(email);
    await page.locator('.card').filter({ hasText: 'Invite' }).locator('select').selectOption('VIEWER');
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByRole('cell', { name: email })).toBeVisible();
  });

  test('usage page shows per-key totals and exports CSV', async ({ page }) => {
    const owner = await seedTenant();
    await seedKeyWithUsage(owner.tenantId, 'Reporting key', 42, new Date(Date.now() - 2 * 86_400_000));
    await login(page, owner);
    await page.getByRole('link', { name: 'Usage' }).click();

    const row = page.getByRole('row', { name: /Reporting key/ });
    await expect(row.getByRole('cell', { name: '42', exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    const csv = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(csv).toString('utf8');
    expect(text.split('\n')[0]).toBe('timestamp,key_name,route,status,latency_ms');
    expect(text.split('\n')).toHaveLength(43);
  });

  test('a BILLING user can see the current invoice', async ({ page }) => {
    const billing = await seedTenant({ role: 'BILLING', plan: 'FREE' });
    await login(page, billing);
    await page.getByRole('link', { name: 'Billing' }).click();
    await expect(page.getByRole('cell', { name: 'Included quota' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '10,000' })).toBeVisible();
  });
});
