import { expect, test } from '@playwright/test';

const customer = {
  id: 'e2e-customer',
  email: 'customer@example.test',
  firstName: 'Test',
  lastName: 'Customer',
  role: 'CUSTOMER',
};

const organizer = {
  id: 'e2e-organizer',
  email: 'organizer@example.test',
  firstName: 'Test',
  lastName: 'Organizer',
  role: 'ORGANIZER',
};

test('account profile and theme preferences save through the authenticated API', async ({
  page,
}) => {
  let profile = {
    ...customer,
    username: null,
    bio: null,
    location: null,
    isEmailVerified: true,
    preferences: { theme: 'light' },
  };
  let savedPreferences: Record<string, unknown> = {};

  await page.addInitScript(() => {
    window.localStorage.setItem('eventai_access_token', 'e2e-access-token');
    window.localStorage.setItem('eventai_theme', 'light');
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { user: customer } }),
  );
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() === 'PATCH') {
      profile = { ...profile, ...route.request().postDataJSON() };
      await route.fulfill({ status: 200, json: { user: profile } });
      return;
    }
    await route.fulfill({ status: 200, json: { user: profile } });
  });
  await page.route('**/api/users/me/preferences', async (route) => {
    savedPreferences = route.request().postDataJSON().preferences;
    await route.fulfill({ status: 200, json: { preferences: savedPreferences } });
  });

  await page.goto('/account');
  await page.getByLabel('First name').fill('Asha');
  await page.getByLabel('Location').fill('Mumbai');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
  expect(profile.firstName).toBe('Asha');
  expect(profile.location).toBe('Mumbai');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(() => savedPreferences.theme).toBe('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('organizer event wizard retries categories and submits event media', async ({
  page,
}) => {
  let categoryRequests = 0;
  const submittedEvents: Array<{
    title: string;
    startDate: string;
    coverImage?: string;
    images?: string[];
  }> = [];
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const localDateTime = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);

  await page.addInitScript(() => {
    window.localStorage.setItem('eventai_access_token', 'e2e-organizer-token');
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { user: organizer } }),
  );
  await page.route('**/api/categories', async (route) => {
    categoryRequests += 1;
    if (categoryRequests <= 2) {
      await route.fulfill({
        status: 503,
        json: { message: 'Categories temporarily unavailable' },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: { categories: [{ id: 'category-music', name: 'Music', slug: 'music' }] },
    });
  });
  await page.route('**/api/organizers/venues', (route) =>
    route.fulfill({
      status: 200,
      json: {
        venues: [
          {
            id: 'venue-demo',
            name: 'Demo Hall',
            address: '1 Main Street',
            city: 'Mumbai',
            state: 'MH',
          },
        ],
      },
    }),
  );
  await page.route('**/api/events', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const submittedEvent = route.request().postDataJSON() as {
      title: string;
      startDate: string;
      coverImage?: string;
      images?: string[];
    };
    submittedEvents.push(submittedEvent);
    await route.fulfill({
      status: 201,
      json: {
        event: {
          id: 'event-created',
          slug: 'e2e-event',
          title: submittedEvent.title,
          status: 'DRAFT',
          startDate: submittedEvent.startDate,
          category: { id: 'category-music', name: 'Music', slug: 'music' },
          venue: { id: 'venue-demo', name: 'Demo Hall', city: 'Mumbai' },
        },
      },
    });
  });
  await page.route('**/api/events/event-created/manage', (route) =>
    route.fulfill({ status: 503, json: { message: 'End of mocked event flow' } }),
  );

  await page.goto('/organizer/events/new');
  await page.getByLabel('Event title').fill('Mumbai Music Night');
  await page
    .getByLabel('Description', { exact: true })
    .fill('A live music evening featuring independent artists in Mumbai.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByText(/Could not load event categories: Categories temporarily unavailable/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry categories' }).click();
  const categorySelect = page.getByRole('combobox', { name: /Category/ });
  await expect(categorySelect).toContainText('Music');

  await categorySelect.selectOption('category-music');
  await page.getByRole('combobox', { name: /Venue/ }).selectOption('venue-demo');
  await page.getByRole('button', { name: 'Continue' }).click();
  expect(submittedEvents).toHaveLength(0);
  await expect(page.getByRole('region', { name: 'Event schedule' })).toBeVisible();
  await page.getByLabel('Starts').fill(localDateTime(start));
  expect(submittedEvents).toHaveLength(0);
  await page.getByLabel('Ends').fill(localDateTime(end));
  expect(submittedEvents).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveAttribute(
    'type',
    'button',
  );
  await page.getByRole('button', { name: 'Continue' }).click();
  expect(submittedEvents).toHaveLength(0);
  await page
    .getByLabel('Cover image URL (optional)')
    .fill('https://images.example.test/cover.jpg');
  await page
    .getByLabel('Additional image URLs (one per line, up to 10 total)')
    .fill('https://images.example.test/gallery.jpg');
  expect(submittedEvents).toHaveLength(0);
  await page.getByRole('button', { name: 'Create draft event' }).click();

  await expect.poll(() => submittedEvents.length).toBe(1);
  const submittedEvent = submittedEvents[0];
  expect(submittedEvent.title).toBe('Mumbai Music Night');
  expect(submittedEvent.coverImage).toBe('https://images.example.test/cover.jpg');
  expect(submittedEvent.images).toEqual([
    'https://images.example.test/cover.jpg',
    'https://images.example.test/gallery.jpg',
  ]);
  await expect(page).toHaveURL(/\/organizer\/events\/event-created\?created=1$/);
});
