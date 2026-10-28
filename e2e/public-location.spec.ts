import { expect, test } from '@playwright/test';

test('venue and event details show location and safe directions links', async ({ page }) => {
  await page.goto('/venues/venue-e2e');
  await expect(page.getByRole('heading', { name: 'Fixture Arts Hall' })).toBeVisible();
  await expect(page.getByText(/123 Example Street, Mumbai, Maharashtra/)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Map showing Fixture Arts Hall' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get directions' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/dir/?api=1&destination=19.076%2C72.8777',
  );

  await page.goto('/events/fixture-live-event');
  await expect(page.getByRole('heading', { name: 'Fixture Live Event' })).toBeVisible();
  await expect(page.getByText('Fixture Arts Hall', { exact: true })).toBeVisible();
  const directions = page.getByRole('link', { name: 'Get directions' });
  await expect(directions).toHaveAttribute(
    'href',
    'https://www.google.com/maps/dir/?api=1&destination=19.076%2C72.8777',
  );
  await expect(directions).toHaveAttribute('target', '_blank');
  await expect(directions).toHaveAttribute('rel', 'noreferrer');
});
