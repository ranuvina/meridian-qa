import { expect, login, seedKeyWithUsage, seedTenant, test } from './fixtures';

/**
 * Regression tests for UI defects that are reported but not fixed in this release.
 * test.fail() means "this is expected to fail until the defect is fixed": the suite stays
 * green, and the test turns red the moment the behaviour changes, prompting removal of fail().
 */
test.describe('Known UI defects', () => {
  test('DEF-021 switching tenant reloads the page data', async ({ page }) => {
    test.fail(true, 'DEF-021: tenant switch keeps showing the previous tenant\'s data');
    const first = await seedTenant();
    const second = await seedTenant({ email: first.email, role: 'ADMIN' });
    await seedKeyWithUsage(first.tenantId, 'first-tenant-key', 1, new Date());
    await seedKeyWithUsage(second.tenantId, 'second-tenant-key', 1, new Date());

    await login(page, first);
    const switcher = page.locator('nav select');
    // Start deterministically on the first tenant (login picks the alphabetically first one).
    await switcher.selectOption({ label: `${first.tenantName} (OWNER)` });
    await page.getByRole('link', { name: 'API keys' }).click();
    await page.reload();
    await expect(page.getByRole('cell', { name: 'first-tenant-key' })).toBeVisible();

    await switcher.selectOption({ label: `${second.tenantName} (ADMIN)` });

    await expect(page.getByRole('cell', { name: 'second-tenant-key' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'first-tenant-key' })).toHaveCount(0);
  });

  test.describe('in a browser west of UTC', () => {
    test.use({ timezoneId: 'America/New_York', locale: 'en-US' });

    test('DEF-013 daily usage shows the correct calendar day', async ({ page }) => {
      test.fail(true, 'DEF-013: dates render one day early west of UTC');
      const owner = await seedTenant({ timezone: 'UTC' });
      const day = new Date(Date.now() - 3 * 86_400_000);
      day.setUTCHours(12, 0, 0, 0);
      await seedKeyWithUsage(owner.tenantId, 'tz-key', 7, day);

      await login(page, owner);
      await page.getByRole('link', { name: 'Usage' }).click();
      const expected = `${day.getUTCMonth() + 1}/${day.getUTCDate()}/${day.getUTCFullYear()}`;
      await expect(page.getByRole('row', { name: `${expected} 7` })).toBeVisible();
    });
  });
});
