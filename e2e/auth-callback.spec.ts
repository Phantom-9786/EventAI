import { expect, test } from '@playwright/test';

const googleUser = {
  id: 'google-user-1',
  email: 'google-user@example.com',
  firstName: 'Google User',
  lastName: null,
  role: 'CUSTOMER',
};

test('Google callback validates the bearer token and updates application auth state', async ({ page }) => {
  let refreshCalls = 0;
  let meAuthorization: string | undefined;

  await page.route('**/api/auth/refresh', async (route) => {
    refreshCalls += 1;
    await route.fulfill({ status: 401, json: { message: 'Missing refresh token' } });
  });
  await page.route('**/api/auth/me', async (route) => {
    const headers = route.request().headers();
    meAuthorization = headers.authorization;
    await route.fulfill({ status: 200, json: { user: googleUser } });
  });
  await page.route('**/api/notifications*', async (route) => {
    await route.fulfill({ status: 200, json: { notifications: [], unreadCount: 0 } });
  });

  await page.goto('/auth/callback#access_token=google-access-token&redirect=%2Fevents');

  await expect(page).toHaveURL(/\/events$/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.locator('#account-popover').getByText('Google User', { exact: true })).toBeVisible();
  expect(meAuthorization).toBe('Bearer google-access-token');
  expect(refreshCalls).toBe(0);
  await expect(page).not.toHaveURL(/access_token/);
});

test('Google callback displays an error when the profile endpoint returns 304', async ({ page }) => {
  await page.route('**/api/auth/refresh', async (route) => {
    await route.fulfill({ status: 401, json: { message: 'Missing refresh token' } });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 304 });
  });

  await page.goto('/auth/callback#access_token=google-access-token&redirect=%2Fevents');

  await expect(page.locator('p[role="alert"]')).toHaveText(
    'Signed in with Google, but the session could not be verified.',
  );
  await expect(page.getByRole('heading', { name: 'Sign-in failed' })).toBeVisible();
});
