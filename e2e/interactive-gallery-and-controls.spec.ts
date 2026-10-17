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
  await page.addInitScript(() => {
    window.localStorage.setItem('eventai_access_token', 'mock-test-token');
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, headers: corsHeaders, json: { user } }),
  );
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, headers: corsHeaders, json: { message: 'No refresh token' } }),
  );
}

test.describe('Feature 1: Interactive Event Gallery & Lightbox', () => {
  const sampleEvent = {
    id: 'ev-gallery-test',
    title: 'Festival of Lights 2026',
    slug: 'festival-of-lights-2026',
    description: 'A spectacular evening with lights and live musical performances.',
    startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 172800000).toISOString(),
    coverImage: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80',
    images: [
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1600&q=85',
      'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1600&q=85',
      'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1600&q=85',
    ],
    category: { id: 'c-1', name: 'Music', slug: 'music' },
    venue: {
      id: 'v-1',
      name: 'Grand Arena',
      address: 'Marine Drive',
      city: 'Mumbai',
      state: 'MH',
      capacity: 5000,
    },
    organizer: { id: 'o-1', organizationName: 'Top Events India', isVerified: true },
    ticketTypes: [],
  };

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

    await page.route(`**/api/events/${sampleEvent.slug}`, (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { event: sampleEvent },
      }),
    );
    await page.route(`**/api/events/${sampleEvent.slug}/similar*`, (route) =>
      route.fulfill({
        status: 200,
        headers: corsHeaders,
        json: { events: [] },
      }),
    );

    await page.goto(`/events/${sampleEvent.slug}`);

    // Verify gallery section and thumbnails are rendered
    const gallerySection = page.locator('#event-gallery');
    await expect(gallerySection).toBeVisible();

    const thumbnails = gallerySection.locator('button[aria-haspopup="dialog"]');
    await expect(thumbnails).toHaveCount(3);

    // 1. Click first thumbnail
    await thumbnails.first().click();

    // 2. Lightbox dialog appears
    const dialog = page.locator('#event-gallery-lightbox');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1 of 3')).toBeVisible();

    // Prominent image is displayed with aspect ratio preserved
    const enlargedImg = dialog.locator('img');
    await expect(enlargedImg).toBeVisible();
    expect(await enlargedImg.getAttribute('src')).toBe(sampleEvent.images[0]);

    // 3. Next image via Next button
    const nextBtn = dialog.locator('button[aria-label="Next image"]');
    await nextBtn.click();
    await expect(dialog.getByText('2 of 3')).toBeVisible();
    expect(await enlargedImg.getAttribute('src')).toBe(sampleEvent.images[1]);

    // 4. Keyboard ArrowRight navigation
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('3 of 3')).toBeVisible();
    expect(await enlargedImg.getAttribute('src')).toBe(sampleEvent.images[2]);

    // 5. Keyboard ArrowLeft navigation
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('2 of 3')).toBeVisible();
    expect(await enlargedImg.getAttribute('src')).toBe(sampleEvent.images[1]);

    // 6. Keyboard Escape closes dialog
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // 7. Re-open and close with Close button
    await thumbnails.nth(1).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('2 of 3')).toBeVisible();
    const closeBtn = dialog.locator('button[aria-label="Close gallery viewer"]');
    await closeBtn.click();
    await expect(dialog).toBeHidden();

    // 8. Re-open and close by clicking backdrop
    await thumbnails.first().click();
    await expect(dialog).toBeVisible();
    // Click outside image container on the backdrop
    await dialog.click({ position: { x: 20, y: 20 } });
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
    await expect(page.getByText('Under Scheduled Maintenance')).toBeVisible();
    await expect(page.getByText('EventPoint is currently upgrading database servers.')).toBeVisible();

    // Admin Recovery Sign In button is present
    const adminLink = page.getByRole('link', { name: /Administrator Sign In/i });
    await expect(adminLink).toBeVisible();
    expect(await adminLink.getAttribute('href')).toBe('/signin');
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
    await expect(page.getByText(/Website Maintenance Active/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Manage in System Controls/i })).toBeVisible();
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
    await expect(page.getByText(/AI Assistant is currently offline for scheduled maintenance/i)).toBeVisible();

    // Chat prompt input and submit button are disabled
    const promptInput = page.locator('textarea, input[placeholder*="Ask anything"]').first();
    await expect(promptInput).toBeDisabled();
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
    await expect(page.getByText(/New event submissions are paused today/i)).toBeVisible();

    // Create event button is disabled
    const createBtn = page.getByRole('button', { name: /Create event/i }).first();
    await expect(createBtn).toBeDisabled();

    // Navigating directly to /organizer/events/new shows maintenance alert
    await page.goto('/organizer/events/new');
    await expect(page.getByText(/Event Creation Temporarily Suspended/i)).toBeVisible();
  });
});
