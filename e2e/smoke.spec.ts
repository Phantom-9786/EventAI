import { expect, test } from '@playwright/test';

/**
 * E2E smoke suite: public browsing, auth, booking-entry UI, and the
 * organizer/admin surfaces. Requires the seeded database (npm run db:seed)
 * with the three published demo events.
 */

const DEMO_CUSTOMER = { email: 'customer@eventai.test', password: 'DemoPass123' };

test('landing page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/EventPoint/i);
});

test('event discovery lists seeded events', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Discover Events' })).toBeVisible();
  await expect(page.getByText('Mumbai Indie Night').first()).toBeVisible();
});

test('event search narrows results', async ({ page }) => {
  await page.goto('/events');
  const search = page.getByPlaceholder(/search/i).first();
  await search.fill('DevCon');
  await search.press('Enter');
  await page.waitForURL(/q=DevCon/);
  await expect(page.getByText('DevCon Mumbai 2026').first()).toBeVisible();
  await expect(page.getByText('Mumbai Indie Night')).toHaveCount(0);
});

test('event detail shows ticket types and booking entry', async ({ page }) => {
  await page.goto('/events');
  await page.getByText('Mumbai Indie Night').first().click();
  await expect(page).toHaveURL(/\/events\/mumbai-indie-night/);
  await expect(page.getByText('General Admission').first()).toBeVisible();
  await expect(page.getByText(/from/i).first()).toBeVisible();
});

test('categories and venues pages render', async ({ page }) => {
  await page.goto('/categories');
  await expect(page.getByText('Music').first()).toBeVisible();
  await page.goto('/venues');
  await expect(page.getByText('Demo Arena').first()).toBeVisible();
});

test('sign in with the seeded customer account', async ({ page }) => {
  await page.goto('/signin');
  await page.getByLabel(/email/i).fill(DEMO_CUSTOMER.email);
  await page.getByLabel(/password/i).fill(DEMO_CUSTOMER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/events/, { timeout: 15_000 });
  await expect(page.getByText(/Hi,/i)).toBeVisible();
});

test('unauthenticated tickets page shows the sign-in gate', async ({ page }) => {
  await page.goto('/tickets');
  await expect(page.getByText(/sign in/i).first()).toBeVisible();
});
