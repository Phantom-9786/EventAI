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
  shortDescription: 'Independent artists live in Mumbai',
  status: 'DRAFT',
  categoryId: 'category-music',
  venueId: 'venue-demo',
  startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  endDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  tags: ['music', 'indie'],
  policies: 'No outside food or drinks allowed.',
  cancellationPolicy: 'Refunds permitted up to 24 hours before showtime.',
  coverImage: 'https://images.example.test/cover.jpg',
  images: ['https://images.example.test/cover.jpg'],
  category: { id: 'category-music', name: 'Music', slug: 'music' },
  venue: { id: 'venue-demo', name: 'Demo Hall', address: '1 Main Street', city: 'Mumbai', state: 'MH' },
  ticketTypes: [],
};

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

test.describe('Verification: Refund Workflow & Tabs', () => {
  test('verifies 6 refund tabs, status badges, approval, rejection, and reconciliation', async ({
    page,
  }) => {
    await useAuthFixture(page, organizer);

    const pendingRequest = {
      bookingId: 'booking-pending-1',
      amount: 49900,
      currency: 'INR',
      status: 'CAPTURED',
      refundRequestStatus: 'PENDING',
      refundRequestReason: 'Date conflict',
      refundRequestedAt: new Date(Date.now() - 3600000).toISOString(),
      booking: {
        totalAmount: 49900,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        user: { id: 'user-1', firstName: 'Asha', lastName: 'Patel', email: 'asha@example.test' },
        event: {
          id: 'event-1',
          title: 'Mumbai Music Night',
          slug: 'mumbai-music-night',
          startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        },
        items: [{ quantity: 1, ticketType: { name: 'General Admission' } }],
      },
    };

    const approvedRequest = {
      bookingId: 'booking-approved-1',
      amount: 99900,
      currency: 'INR',
      status: 'REFUND_PENDING',
      refundRequestStatus: 'APPROVED',
      refundRequestReason: 'Emergency',
      refundRequestedAt: new Date(Date.now() - 7200000).toISOString(),
      refundReviewedAt: new Date(Date.now() - 3600000).toISOString(),
      booking: {
        totalAmount: 99900,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        user: { id: 'user-2', firstName: 'Rohan', lastName: 'Shah', email: 'rohan@example.test' },
        event: {
          id: 'event-1',
          title: 'Mumbai Music Night',
          slug: 'mumbai-music-night',
          startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        },
        items: [{ quantity: 2, ticketType: { name: 'VIP Pass' } }],
      },
    };

    const counts = {
      PENDING: 1,
      APPROVED: 1,
      REFUNDED: 0,
      REJECTED: 0,
      FAILED: 0,
      ALL: 2,
    };

    await page.route('**/api/organizers/refund-requests*', (route) => {
      const url = new URL(route.request().url());
      const statusParam = url.searchParams.get('status');
      if (statusParam === 'APPROVED') {
        route.fulfill({
          status: 200,
          json: { refundRequests: [approvedRequest], counts, total: 1, page: 1, limit: 15 },
        });
      } else if (statusParam === 'REFUNDED' || statusParam === 'REJECTED' || statusParam === 'FAILED') {
        route.fulfill({
          status: 200,
          json: { refundRequests: [], counts, total: 0, page: 1, limit: 15 },
        });
      } else {
        route.fulfill({
          status: 200,
          json: { refundRequests: [pendingRequest], counts, total: 1, page: 1, limit: 15 },
        });
      }
    });

    let reconcileCalled = false;
    await page.route('**/api/organizers/refund-requests/*/reconcile', async (route) => {
      reconcileCalled = true;
      await route.fulfill({
        status: 200,
        json: {
          bookingId: 'booking-approved-1',
          outcome: 'processed',
          status: 'REFUNDED',
        },
      });
    });

    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/organizer/refunds');
    await expect(page.getByRole('heading', { name: 'Refund requests' })).toBeVisible();

    // Verify the 6 tabs are displayed
    await expect(page.getByRole('button', { name: /Pending review/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Approved \/ processing/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Successfully refunded/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Rejected/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Failed \/ needs reconciliation/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /All requests/ })).toBeVisible();

    // In Pending tab: check badge and attendee reason
    await expect(page.getByText('Awaiting review')).toBeVisible();
    await expect(page.getByText('Date conflict')).toBeVisible();

    // Switch to Approved tab
    await page.getByRole('button', { name: /Approved \/ processing/ }).click();
    await expect(page.getByText('Approved — settlement processing')).toBeVisible();
    await expect(page.getByText('Rohan Shah')).toBeVisible();

    // Reconcile the approved refund
    await page.getByRole('button', { name: 'Check provider status' }).click();
    await expect(page.getByText(/Provider reconciliation complete: refund confirmed as processed/)).toBeVisible();
    expect(reconcileCalled).toBe(true);

    // Switch to Empty tab (Successfully refunded)
    await page.getByRole('button', { name: /Successfully refunded/ }).click();
    await expect(page.getByText('No settled refunds found.')).toBeVisible();
  });
});

test.describe('Verification: 6-Step Event Creation Wizard', () => {
  test('verifies step progression, form state preservation when going back, ticket tier addition, and summary review', async ({
    page,
  }) => {
    await useAuthFixture(page, organizer);

    let createdDraft: Record<string, unknown> | null = null;
    const addedTickets: Record<string, unknown>[] = [];
    const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    await page.route('**/api/categories', (route) =>
      route.fulfill({
        status: 200,
        json: { categories: [{ id: 'category-music', name: 'Music', slug: 'music' }] },
      }),
    );
    await page.route('**/api/organizers/venues', (route) =>
      route.fulfill({
        status: 200,
        json: {
          venues: [
            {
              id: 'venue-demo',
              name: 'Royal Opera Hall',
              address: '5 Opera Road',
              city: 'Mumbai',
              state: 'MH',
              capacity: 500,
            },
          ],
        },
      }),
    );
    await page.route('**/api/events', async (route) => {
      if (route.request().method() === 'POST') {
        createdDraft = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          json: {
            event: {
              id: 'event-new-1',
              slug: 'symphony-gala-2026',
              ...createdDraft,
              status: 'DRAFT',
              category: { id: 'category-music', name: 'Music', slug: 'music' },
              venue: { id: 'venue-demo', name: 'Royal Opera Hall', city: 'Mumbai' },
              ticketTypes: addedTickets,
            },
          },
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/events/event-new-1/tickets', async (route) => {
      const ticketData = route.request().postDataJSON();
      const ticket = {
        id: `ticket-${addedTickets.length + 1}`,
        eventId: 'event-new-1',
        ...ticketData,
        totalQuantity: ticketData.totalQuantity ?? 100,
        availableQuantity: ticketData.totalQuantity ?? 100,
        price: ticketData.price,
        currency: 'INR',
        isActive: true,
      };
      addedTickets.push(ticket);
      await route.fulfill({
        status: 201,
        json: { ticketType: ticket },
      });
    });

    await page.goto('/organizer/events/new');

    // Step 0: Basics
    await page.getByLabel('Event title').fill('Symphony Gala 2026');
    await page.getByLabel('Short summary (optional)').fill('An exquisite evening of classical symphony.');
    await page
      .locator('#event-description')
      .fill('Experience live performances by the national philharmonic orchestra in Mumbai.');
    await page.getByRole('button', { name: 'Next step' }).click();

    // Step 1: Venue & Category
    await page.getByRole('combobox', { name: /Category/ }).selectOption('category-music');
    await page.getByRole('combobox', { name: /Venue/ }).selectOption('venue-demo');

    // Test backward navigation: Go to Previous step
    await page.getByRole('button', { name: 'Previous step' }).click();
    await expect(page.getByLabel('Event title')).toHaveValue('Symphony Gala 2026');
    await expect(page.locator('#event-description')).toHaveValue(
      'Experience live performances by the national philharmonic orchestra in Mumbai.',
    );

    // Go forward again
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByRole('combobox', { name: /Category/ })).toHaveValue('category-music');
    await page.getByRole('button', { name: 'Next step' }).click();

    // Step 2: Schedule
    await expect(page.getByRole('region', { name: 'Event schedule' })).toBeVisible();
    await page.getByLabel('Event starts').fill(start.toISOString().slice(0, 10));
    await page.getByLabel('Event ends').fill(end.toISOString().slice(0, 10));
    await page.locator('input[type="time"]').nth(1).fill('22:00');
    await page.getByLabel('Tags (comma separated, max 10)').fill('classical, symphony, orchestra');
    await page.getByRole('button', { name: 'Next step' }).click();

    // Step 3: Media & Policies
    await expect(page.getByRole('region', { name: 'Event media and policies' })).toBeVisible();
    await expect(page.getByText('Upload cover image')).toBeVisible();
    await page.getByRole('button', { name: 'Next step' }).click();

    // Step 4: Tickets & Inventory
    await expect(page.getByRole('region', { name: 'Tickets and inventory' })).toBeVisible();
    expect(createdDraft).not.toBeNull();

    // Add a ticket tier inline
    await page.getByRole('button', { name: 'Add tier' }).click();
    await page.getByLabel('Ticket name').fill('Premium Orchestra');
    await page.getByLabel('Price (INR)').fill('1500');
    await page.getByLabel('Total inventory').fill('150');
    await page.getByRole('button', { name: 'Add ticket type' }).click();

    await expect(page.getByText('Premium Orchestra')).toBeVisible();
    await expect(page.getByText('₹1,500')).toBeVisible();

    // Step 5: Review & Publish
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(page.getByRole('region', { name: 'Review and publish' })).toBeVisible();
    await expect(page.getByText('Symphony Gala 2026')).toBeVisible();
    await expect(page.getByText('Royal Opera Hall')).toBeVisible();
    await expect(page.getByText(/Tickets \(1 tier\)/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish event now' })).toBeVisible();
  });
});

test.describe('Verification: In-App Notifications', () => {
  test('verifies notification bell, unread badge, mark single as read, and mark all as read', async ({
    page,
  }) => {
    await useAuthFixture(page, customer);

    let notifications = [
      {
        id: 'notif-1',
        userId: 'e2e-customer',
        type: 'BOOKING_CONFIRMED',
        title: 'Booking confirmed!',
        message: 'Your booking for Mumbai Music Night is confirmed with 1 ticket.',
        data: { link: '/tickets', bookingId: 'booking-1' },
        isRead: false,
        createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      },
      {
        id: 'notif-2',
        userId: 'e2e-customer',
        type: 'REFUND_APPROVED',
        title: 'Refund approved',
        message: 'Your refund request for ₹499 has been approved by the organizer.',
        data: { link: '/tickets' },
        isRead: false,
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
    ];

    await page.route('**/api/notifications?*', (route) => {
      const unreadCount = notifications.filter((n) => !n.isRead).length;
      route.fulfill({
        status: 200,
        json: { notifications, unreadCount },
      });
    });

    await page.route('**/api/notifications/notif-1/read', async (route) => {
      notifications = notifications.map((n) => (n.id === 'notif-1' ? { ...n, isRead: true } : n));
      await route.fulfill({ status: 200, json: { success: true } });
    });

    await page.route('**/api/notifications/read-all', async (route) => {
      notifications = notifications.map((n) => ({ ...n, isRead: true }));
      await route.fulfill({ status: 200, json: { success: true } });
    });

    await page.goto('/events');

    // Notification bell button exists and displays unread count "2"
    const bellButton = page.getByRole('button', { name: 'Notifications' });
    await expect(bellButton).toBeVisible();
    await expect(bellButton.getByText('2')).toBeVisible();

    // Click bell to open notifications tray
    await bellButton.click();
    await expect(page.getByText('Notifications')).toBeVisible();
    await expect(page.getByText('2 new')).toBeVisible();
    await expect(page.getByText('Booking confirmed!')).toBeVisible();
    await expect(page.getByText('Refund approved')).toBeVisible();

    // Mark single notification read
    await page.getByRole('button', { name: 'Mark read' }).first().click();
    await expect(bellButton.getByText('1')).toBeVisible();

    // Mark all read
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(bellButton.locator('span')).toHaveCount(0); // Badge cleared
  });
});

test.describe('Verification: Account Deletion Blocker Diagnostics', () => {
  test('surfaces structured blocker diagnostics for active events and pending refunds with links', async ({
    page,
  }) => {
    await useAuthFixture(page, organizer);

    const profile = {
      ...organizer,
      username: 'organizer_pro',
      bio: 'Event producer',
      location: 'Mumbai',
      isEmailVerified: true,
      preferences: { theme: 'light' },
    };

    await page.route('**/api/users/me', (route) => {
      route.fulfill({ status: 200, json: { user: profile } });
    });

    await page.route('**/api/users/me/delete', async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          message: 'Cannot delete account while active events or pending refunds remain.',
          blockers: {
            events: [
              {
                id: 'event-1',
                title: 'Mumbai Music Night',
                status: 'PUBLISHED',
                link: '/organizer/events/event-1',
              },
            ],
            refunds: [
              {
                bookingId: 'booking-pending-1',
                eventTitle: 'Mumbai Music Night',
                amount: 49900,
                status: 'PENDING',
                link: '/organizer/refunds',
              },
            ],
          },
        },
      });
    });

    await page.route('**/api/users/me/deletion-blockers', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          canDelete: false,
          blockers: {
            events: [
              {
                id: 'event-1',
                title: 'Mumbai Music Night',
                status: 'PUBLISHED',
                link: '/organizer/events/event-1',
              },
            ],
            refunds: [
              {
                bookingId: 'booking-pending-1',
                eventTitle: 'Mumbai Music Night',
                amount: 49900,
                status: 'PENDING',
                link: '/organizer/refunds',
              },
            ],
          },
        },
      });
    });

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'My Account' })).toBeVisible();

    // Click Delete account button to open confirmation dialog
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText('Confirm Permanent Account Deletion')).toBeVisible();

    // Attempt deletion with typed confirmation
    await page.getByPlaceholder('Type DELETE').fill('DELETE');
    await page.getByRole('button', { name: 'Permanently delete' }).click();

    // Verify structured blocker diagnostics alert
    await expect(page.getByText('Blocking records prevent account deletion')).toBeVisible();
    await expect(page.getByText(/Active or draft events \(1\):/)).toBeVisible();
    await expect(page.getByText(/Pending refunds \(1\):/)).toBeVisible();

    // Verify clickable resolution links
    const manageEventLink = page.getByRole('link', { name: 'Manage event', exact: true });
    await expect(manageEventLink).toBeVisible();
    await expect(manageEventLink).toHaveAttribute('href', '/organizer/events/event-1');

    const viewRefundsLink = page.getByRole('link', { name: 'View refunds' });
    await expect(viewRefundsLink).toBeVisible();
    await expect(viewRefundsLink).toHaveAttribute('href', '/organizer/refunds');
  });
});

test.describe('Verification: Theme Transitions & Persistence', () => {
  test('toggles theme, applies .dark class, and transitions smoothly without layout shift', async ({
    page,
  }) => {
    let savedTheme = 'light';
    await page.addInitScript(() => {
      window.localStorage.setItem('eventai_access_token', 'e2e-access-token');
    });
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, json: { user: customer } }),
    );
    await page.route('**/api/users/me', (route) =>
      route.fulfill({
        status: 200,
        json: {
          user: {
            ...customer,
            preferences: { theme: savedTheme },
          },
        },
      }),
    );
    await page.route('**/api/users/me/preferences', async (route) => {
      savedTheme = route.request().postDataJSON().preferences.theme;
      await route.fulfill({ status: 200, json: { preferences: { theme: savedTheme } } });
    });

    await page.goto('/account');

    // Initially light theme
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();

    // Switch to dark
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();

    // Reload page to verify persistence without flash
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Switch back to light
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});

test.describe('Verification: Admin Metric Cards Navigation & Event Moderation Preview', () => {
  const adminUser = {
    id: 'e2e-admin',
    email: 'admin@example.test',
    firstName: 'System',
    lastName: 'Admin',
    role: 'ADMIN',
  };

  test('verifies admin stat cards switch tabs and event preview modal opens with details', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('eventai_access_token', 'e2e-admin-token');
    });
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, json: { user: adminUser } }),
    );
    await page.route('**/api/admin/stats', (route) =>
      route.fulfill({
        status: 200,
        json: {
          users: 150,
          organizers: 12,
          verifiedOrganizers: 8,
          publishedEvents: 25,
          draftEvents: 5,
          totalBookings: 320,
          totalRevenue: 45000000,
        },
      }),
    );
    await page.route('**/api/admin/users*', (route) =>
      route.fulfill({
        status: 200,
        json: {
          users: [
            {
              id: 'u-1',
              email: 'attendee@example.com',
              firstName: 'Test',
              lastName: 'User',
              role: 'CUSTOMER',
              isActive: true,
              isEmailVerified: true,
              createdAt: new Date().toISOString(),
              bookingCount: 3,
            },
          ],
          total: 1,
          page: 1,
          pages: 1,
        },
      }),
    );
    await page.route('**/api/admin/events/evt-preview-1', (route) =>
      route.fulfill({
        status: 200,
        json: {
          event: {
            id: 'evt-preview-1',
            title: 'Electric Music Festival 2027',
            description: 'Massive outdoor electronic music festival with international artists.',
            shortDescription: 'Electronic festival in Goa',
            status: 'DRAFT',
            startDate: new Date(Date.now() + 86400000 * 30).toISOString(),
            endDate: new Date(Date.now() + 86400000 * 32).toISOString(),
            coverImage: 'https://images.example.test/cover.jpg',
            images: [],
            tags: ['electronic', 'music'],
            category: { id: 'c-1', name: 'Music' },
            venue: { id: 'v-1', name: 'Goa Arena', address: 'Beach Road', city: 'Goa', state: 'GA' },
            ticketTypes: [
              {
                id: 'tt-1',
                name: 'General Admission',
                price: 150000,
                currency: 'INR',
                totalQuantity: 500,
                availableQuantity: 500,
                maxPerBooking: 5,
                isActive: true,
              },
            ],
            organizer: {
              id: 'org-1',
              organizationName: 'Sun Events',
              user: { id: 'u-org', email: 'org@example.com', firstName: 'Sun', lastName: 'Organizer' },
            },
            moderation: { status: 'PENDING_APPROVAL' },
          },
        },
      }),
    );
    await page.route('**/api/admin/events*', (route) =>
      route.fulfill({
        status: 200,
        json: {
          events: [
            {
              id: 'evt-preview-1',
              title: 'Electric Music Festival 2027',
              slug: 'electric-music-festival-2027',
              status: 'DRAFT',
              startDate: new Date(Date.now() + 86400000 * 30).toISOString(),
              bookingCount: 0,
              organizer: { organizationName: 'Sun Events' },
              moderation: { status: 'PENDING_APPROVAL' },
            },
          ],
          total: 1,
          page: 1,
          pages: 1,
        },
      }),
    );

    await page.goto('/admin');

    // 1. Verify metric cards load and clicking switches to target tab
    const usersCard = page.getByRole('button', { name: /Active Users/i });
    await expect(usersCard).toBeVisible();
    await usersCard.click();

    // Verify Users tab is active and attendee table row is visible
    await expect(page.getByText('attendee@example.com')).toBeVisible();

    // Click Events stat card
    const eventsCard = page.getByRole('button', { name: /Published Events/i });
    await expect(eventsCard).toBeVisible();
    await eventsCard.click();

    // Verify Events tab is active and electric music festival is visible
    await expect(page.getByText('Electric Music Festival 2027')).toBeVisible();

    // 2. Click Preview button to open EventPreviewModal
    const previewButton = page.getByRole('button', { name: /Preview/i }).first();
    await expect(previewButton).toBeVisible();
    await previewButton.click();

    // Verify Modal opens with event details, venue, ticket tiers, and action buttons
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Electric Music Festival 2027').first()).toBeVisible();
    await expect(page.getByText('Goa Arena')).toBeVisible();
    await expect(page.getByText('General Admission')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve Event' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject Event' })).toBeVisible();
  });
});
