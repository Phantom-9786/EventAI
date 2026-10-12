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

const eventManageFixture = {
  id: 'event-1',
  slug: 'mumbai-music-night',
  title: 'Mumbai Music Night',
  description: 'A live music evening featuring independent artists in Mumbai.',
  shortDescription: null,
  status: 'DRAFT',
  categoryId: 'category-music',
  venueId: 'venue-demo',
  startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  endDate: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
  tags: [],
  policies: null,
  cancellationPolicy: null,
  coverImage: null,
  images: [],
  category: { id: 'category-music', name: 'Music', slug: 'music' },
  venue: { id: 'venue-demo', name: 'Demo Hall', address: '1 Main Street', city: 'Mumbai', state: 'MH' },
  ticketTypes: [],
};

const refundRequestFixture = (bookingId: string, title: string) => ({
  bookingId,
  amount: 49900,
  currency: 'INR',
  refundRequestReason: 'Plans changed',
  refundRequestedAt: '2026-10-12T12:00:00.000Z',
  booking: {
    totalAmount: 49900,
    createdAt: '2026-10-10T12:00:00.000Z',
    user: { id: 'e2e-customer', firstName: 'Test', lastName: 'Customer', email: customer.email },
    event: {
      id: 'event-1',
      title,
      slug: 'mumbai-music-night',
      startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    },
    items: [{ quantity: 1, ticketType: { name: 'General Admission' } }],
  },
});

async function useAuthFixture(page: import('@playwright/test').Page, user = customer) {
  await page.addInitScript(() => {
    window.localStorage.setItem('eventai_access_token', 'e2e-access-token');
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { user } }),
  );
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { message: 'No refresh session in test fixture' } }),
  );
}

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

test('login opens My Account and theme choice persists across reloads', async ({ page }) => {
  const profile = {
    ...customer,
    username: null,
    bio: null,
    location: 'Mumbai',
    isEmailVerified: true,
    preferences: { theme: 'light' },
  };
  let preferences: Record<string, unknown> = { theme: 'light' };
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { message: 'No refresh session in test fixture' } }),
  );
  await page.route('**/api/auth/login', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: customer.email,
      password: 'test-password',
    });
    await route.fulfill({ status: 200, json: { user: customer, accessToken: 'e2e-access-token' } });
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, json: { user: customer } }),
  );
  await page.route('**/api/users/me', (route) =>
    route.fulfill({ status: 200, json: { user: { ...profile, preferences } } }),
  );
  await page.route('**/api/users/me/preferences', async (route) => {
    preferences = route.request().postDataJSON().preferences;
    await route.fulfill({ status: 200, json: { preferences } });
  });

  await page.goto('/signin');
  await page.getByLabel('Email').fill(customer.email);
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.getByRole('link', { name: 'My Account' }).click();
  await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible();
  await expect(page.getByLabel('Location')).toHaveValue('Mumbai');

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(() => preferences.theme).toBe('dark');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('My Tickets shows booking and ticket state and creates only an approval request', async ({
  page,
}) => {
  await useAuthFixture(page);
  let refundRequestCount = 0;
  let providerRequests = 0;
  await page.route('**/api/bookings?*', (route) =>
    route.fulfill({
      status: 200,
      json: {
        bookings: [{
          id: 'booking-1',
          status: 'CONFIRMED',
          totalAmount: 49900,
          expiresAt: null,
          event: {
            id: 'event-1',
            title: 'Mumbai Music Night',
            slug: 'mumbai-music-night',
            startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            venue: { name: 'Demo Hall', city: 'Mumbai' },
          },
          items: [{ id: 'item-1', quantity: 1, ticketType: { name: 'General Admission' } }],
          payment: {
            id: 'payment-1',
            status: 'CAPTURED',
            amount: 49900,
            refundRequestStatus: null,
            refundRequestReason: null,
            refundRequestedAt: null,
          },
          tickets: [{ id: 'ticket-1', ticketCode: 'TKT-E2E-1', holderName: 'Test Customer', status: 'VALID' }],
        }],
        total: 1,
        pages: 1,
      },
    }),
  );
  await page.route('**/api/payments/tickets/ticket-1/qr', (route) =>
    route.fulfill({ status: 200, json: { dataUrl: 'data:image/png;base64,dGVzdA==' } }),
  );
  await page.route('**/api/payments/refund', async (route) => {
    refundRequestCount += 1;
    expect(route.request().postDataJSON()).toEqual({
      bookingId: 'booking-1',
      reason: 'Customer refund request',
    });
    await route.fulfill({
      status: 201,
      json: {
        refundRequest: {
          bookingId: 'booking-1',
          status: 'PENDING',
          reason: 'Customer refund request',
          requestedAt: '2026-10-12T12:00:00.000Z',
        },
      },
    });
  });
  await page.route('https://api.razorpay.com/**', async (route) => {
    providerRequests += 1;
    await route.abort();
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'My Tickets' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mumbai Music Night' })).toBeVisible();
  await expect(page.getByText('TKT-E2E-1')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ticket QR code' })).toBeVisible();
  await page.getByRole('button', { name: 'Request refund' }).click();
  await expect(page.getByRole('status')).toContainText('sent to the event organizer');
  await expect(page.getByText(/Refund request awaiting organizer approval/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refund request submitted' })).toBeDisabled();
  expect(refundRequestCount).toBe(1);
  expect(providerRequests).toBe(0);
});

test('organizer can edit, publish, and cancel an event without calling payment providers', async ({
  page,
}) => {
  await useAuthFixture(page, organizer);
  let status = 'DRAFT';
  const requests: string[] = [];
  await page.route('**/api/categories', (route) =>
    route.fulfill({ status: 200, json: { categories: [{ id: 'category-music', name: 'Music', slug: 'music' }] } }),
  );
  await page.route('**/api/organizers/venues', (route) =>
    route.fulfill({ status: 200, json: { venues: [{ id: 'venue-demo', name: 'Demo Hall', address: '1 Main Street', city: 'Mumbai', state: 'MH' }] } }),
  );
  await page.route('**/api/events/event-1/manage', (route) =>
    route.fulfill({ status: 200, json: { event: { ...eventManageFixture, status } } }),
  );
  await page.route('**/api/events/event-1', async (route) => {
    if (route.request().method() === 'PATCH') {
      requests.push('edit');
      const update = route.request().postDataJSON();
      await route.fulfill({ status: 200, json: { event: { ...eventManageFixture, ...update, status } } });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/events/event-1/publish', async (route) => {
    requests.push('publish');
    status = 'PUBLISHED';
    await route.fulfill({ status: 200, json: { event: { ...eventManageFixture, status } } });
  });
  await page.route('**/api/events/event-1/cancel', async (route) => {
    requests.push('cancel');
    status = 'CANCELLED';
    await route.fulfill({
      status: 200,
      json: {
        event: { ...eventManageFixture, status },
        refundRequestsQueued: 1,
        bookingsCancelled: 1,
      },
    });
  });
  let providerRequests = 0;
  await page.route('https://api.razorpay.com/**', async (route) => {
    providerRequests += 1;
    await route.abort();
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/organizer/events/event-1');
  await expect(page.getByRole('heading', { name: 'Manage event' })).toBeVisible();
  await page.getByLabel('Event title').fill('Edited Mumbai Music Night');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Save draft changes' }).click();
  await expect(page.getByRole('status')).toContainText('Event details saved.');
  await page.getByRole('button', { name: 'Publish event' }).click();
  await expect(page.getByText('Event published.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel event' }).click();
  await expect(page.getByText(/queued for organizer refund approval/)).toBeVisible();
  expect(status).toBe('CANCELLED');
  expect(requests).toEqual(['edit', 'publish', 'cancel']);
  expect(providerRequests).toBe(0);
});

test('organizer refund approvals and rejections use only the mocked application API', async ({
  page,
}) => {
  await useAuthFixture(page, organizer);
  let requests = [
    refundRequestFixture('booking-approved', 'Approval fixture event'),
    refundRequestFixture('booking-rejected', 'Rejection fixture event'),
  ];
  const decisions: string[] = [];
  let providerRequests = 0;
  await page.route('**/api/organizers/refund-requests', (route) =>
    route.fulfill({ status: 200, json: { refundRequests: requests } }),
  );
  await page.route('**/api/organizers/refund-requests/*/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const decision = path.endsWith('/approve') ? 'approve' : 'reject';
    const bookingId = path.split('/').at(-2)!;
    decisions.push(`${bookingId}:${decision}`);
    requests = requests.filter((request) => request.bookingId !== bookingId);
    await route.fulfill({
      status: 200,
      json: {
        bookingId,
        status: decision === 'approve' ? 'APPROVED' : 'REJECTED',
        refundStatus: decision === 'approve' ? 'pending' : undefined,
      },
    });
  });
  await page.route('https://api.razorpay.com/**', async (route) => {
    providerRequests += 1;
    await route.abort();
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/organizer/refunds');
  await expect(page.getByRole('heading', { name: 'Refund requests' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and issue refund' }).first().click();
  await expect(page.getByText(/Reconciliation is required/)).toBeVisible();
  await page.getByRole('button', { name: 'Reject request' }).click();
  await expect(page.getByText(/request rejected/)).toBeVisible();
  expect(decisions).toEqual(['booking-approved:approve', 'booking-rejected:reject']);
  expect(providerRequests).toBe(0);
});

test('account deactivation is cancellable and surfaces an organizer-safety conflict', async ({
  page,
}) => {
  await useAuthFixture(page, organizer);
  const profile = { ...organizer, username: null, bio: null, location: null, isEmailVerified: true };
  let deactivationRequests = 0;
  let logoutRequests = 0;
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() === 'DELETE') {
      deactivationRequests += 1;
      await route.fulfill({ status: 409, json: { message: 'Resolve active organizer events first' } });
      return;
    }
    await route.fulfill({ status: 200, json: { user: profile } });
  });
  await page.route('**/api/auth/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 200, json: { success: true } });
  });

  await page.goto('/account');
  await page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Deactivate my account' }).click();
  expect(deactivationRequests).toBe(0);

  await page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Deactivate my account' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Account deactivation failed (409)');
  expect(deactivationRequests).toBe(1);
  expect(logoutRequests).toBe(0);
  await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible();
});
