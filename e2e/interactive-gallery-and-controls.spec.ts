import { expect, test } from '@playwright/test';

const adminUser = {
  id: 'admin-uuid-1',
  email: 'admin@eventpoint.test',
  firstName: 'Admin',
  lastName: 'User',
  role: 'ADMIN',
};

const organizerUser = {
  id: 'organizer-uuid-1',
  email: 'organizer@eventpoint.test',
  firstName: 'Organizer',
  lastName: 'User',
  role: 'ORGANIZER',
};

const corsHeaders = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-credentials': 'true',
  'content-type': 'application/json',
};

async function setAuth(page: import('@playwright/test').Page, user = adminUser) {
  await page.addInitScript((userData) => {
    window.localStorage.setItem('eventai_access_token', 'mock-test-token');
    window.localStorage.setItem('eventai_user', JSON.stringify(userData));
  }, user);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, headers: corsHeaders, json: { user } }),
  );
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, headers: corsHeaders, json: { message: 'No refresh token' } }),
  );
}

test.describe('Feature 1: Interactive Event Gallery & Lightbox', () => {
  const existingEventSlug = 'echoes-in-the-valley-indie-music-festival-2027';

  test('clicking thumbnail opens high-res lightbox with navigation, keyboard shortcuts, and close behavior', async ({
    page,
  }) => {
    // Default public system controls (no maintenance)
    await page.route('**/api/system-controls', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          websiteMaintenance: false,
          aiMaintenance: false,
          eventCreationMaintenance: false,
        },
      }),
    );

    await page.goto(`/events/${existingEventSlug}`);

    // Verify gallery section and thumbnails are rendered
    const gallerySection = page.getByRole('region', { name: 'Event gallery' });
    await expect(gallerySection).toBeVisible({ timeout: 15000 });

    const thumbnails = gallerySection.locator('button[aria-haspopup="dialog"]');
    const thumbCount = await thumbnails.count();
    expect(thumbCount).toBeGreaterThanOrEqual(1);

    // 1. Click first thumbnail
    await thumbnails.first().click();

    // 2. Lightbox dialog appears
    const dialog = page.locator('#event-gallery-lightbox');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`1 of ${thumbCount}`)).toBeVisible();

    // Prominent image is displayed with aspect ratio preserved
    const enlargedImg = dialog.locator('img');
    await expect(enlargedImg).toBeVisible();

    if (thumbCount > 1) {
      // 3. Next image via Next button
      const nextBtn = dialog.locator('button[aria-label="Next image"]');
      await nextBtn.click();
      await expect(dialog.getByText(`2 of ${thumbCount}`)).toBeVisible();

      // 4. Keyboard ArrowLeft navigation
      await page.keyboard.press('ArrowLeft');
      await expect(dialog.getByText(`1 of ${thumbCount}`)).toBeVisible();

      // 5. Keyboard ArrowRight navigation
      await page.keyboard.press('ArrowRight');
      await expect(dialog.getByText(`2 of ${thumbCount}`)).toBeVisible();
    }

    // 6. Keyboard Escape closes dialog
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // 7. Re-open and close with Close button
    await thumbnails.first().click();
    await expect(dialog).toBeVisible();
    const closeBtn = dialog.locator('button[aria-label="Close image viewer"]');
    await closeBtn.click();
    await expect(dialog).toBeHidden();

    // 8. Re-open and close by clicking backdrop overlay
    await thumbnails.first().click();
    await expect(dialog).toBeVisible();
    // Click outside image container on the backdrop
    await dialog.click({ position: { x: 40, y: 300 } });
    await expect(dialog).toBeHidden();
  });
});

test.describe('Features 2-4: Admin System Controls & Maintenance Modes', () => {
  test('Website Maintenance displays maintenance page to public visitors with admin recovery', async ({
    page,
  }) => {
    await page.route('**/api/system-controls', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          websiteMaintenance: true,
          websiteMaintenanceMessage: 'EventPoint is currently upgrading database servers.',
          aiMaintenance: false,
          eventCreationMaintenance: false,
        },
      }),
    );

    await page.goto('/events');

    // Public visitor sees maintenance screen
    await expect(page.getByText(/EventPoint is Under Maintenance/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('EventPoint is currently upgrading database servers.')).toBeVisible();

    // Admin Recovery Sign In button is present
    const adminLink = page.getByRole('link', { name: /Administrator Access/i });
    await expect(adminLink).toBeVisible();
    expect(await adminLink.getAttribute('href')).toBe('/signin');
  });

  test('Website Maintenance allows /forgot-password and /reset-password routes for system recovery', async ({
    page,
  }) => {
    await page.route('**/api/system-controls', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          websiteMaintenance: true,
          websiteMaintenanceMessage: 'EventPoint is currently upgrading database servers.',
          aiMaintenance: false,
          eventCreationMaintenance: false,
        },
      }),
    );

    // 1. /forgot-password page is accessible and displays recovery banner
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: /Reset your password/i })).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/Website Maintenance is active. Administrator authentication and password recovery are available/i),
    ).toBeVisible();
    await expect(page.getByText(/EventPoint is Under Maintenance/i)).toBeHidden();

    // 2. /reset-password page is accessible and displays recovery banner
    await page.goto('/reset-password?token=sample-token');
    await expect(page.getByRole('heading', { name: /Choose a new password/i })).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText(/Website Maintenance is active. Administrator authentication and password recovery are available/i),
    ).toBeVisible();
    await expect(page.getByText(/EventPoint is Under Maintenance/i)).toBeHidden();
  });

  test('Website Maintenance displays warning banner to authenticated Admin with access preserved', async ({
    page,
  }) => {
    await setAuth(page, adminUser);

    await page.route('**/api/system-controls', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          websiteMaintenance: true,
          websiteMaintenanceMessage: 'Maintenance active for users',
          aiMaintenance: false,
          eventCreationMaintenance: false,
        },
      }),
    );

    await page.goto('/');

    // Admin sees banner
    await expect(page.getByText(/Website Maintenance Mode is ACTIVE/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: /System Controls/i }).first()).toBeVisible();
  });

  test('AI Assistant Maintenance disables AI chat interface with clear status notice', async ({
    page,
  }) => {
    await page.route('**/api/system-controls', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          websiteMaintenance: false,
          aiMaintenance: true,
          aiMaintenanceMessage: 'AI Assistant is currently offline for scheduled maintenance.',
          eventCreationMaintenance: false,
        },
      }),
    );

    await page.goto('/ai');

    // Maintenance notice is visible
    await expect(page.getByText(/AI Assistant Offline/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/AI Assistant is currently offline for scheduled maintenance/i)).toBeVisible();

    // Chat prompt input and submit button are disabled
    const promptInput = page.locator('input[aria-label="Message the assistant"]');
    await expect(promptInput).toBeDisabled();

    const sendBtn = page.getByRole('button', { name: /Send/i });
    await expect(sendBtn).toBeDisabled();
  });

  test('Event Creation Maintenance disables create event CTA and blocks new event form', async ({
    page,
  }) => {
    await setAuth(page, organizerUser);

    await page.route('**/api/system-controls', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: {
          websiteMaintenance: false,
          aiMaintenance: false,
          eventCreationMaintenance: true,
          eventCreationMaintenanceMessage: 'New event submissions are paused today.',
        },
      }),
    );

    await page.route('**/api/organizers/events*', (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { events: [], total: 0, page: 1, limit: 10 },
      }),
    );

    await page.goto('/organizer/events');

    // Warning banner is displayed
    await expect(page.getByText(/New event submissions are paused today/i)).toBeVisible({ timeout: 15000 });

    // Create event button is disabled
    const createBtn = page.getByRole('button', { name: /Create event/i }).first();
    await expect(createBtn).toBeDisabled();

    // Navigating directly to /organizer/events/new shows maintenance alert
    await page.goto('/organizer/events/new');
    await expect(page.getByText(/New Event Creation Unavailable/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Event Creation Paused/i)).toBeVisible();
  });
});
