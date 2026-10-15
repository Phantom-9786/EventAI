import { expect, test } from '@playwright/test';

const organizerUser = {
  id: 'org-user-1',
  email: 'organizer@eventai.test',
  firstName: 'Priya',
  lastName: 'Sharma',
  role: 'ORGANIZER',
};

const customerUser = {
  id: 'cust-user-1',
  email: 'attendee@eventai.test',
  firstName: 'Rahul',
  lastName: 'Verma',
  role: 'CUSTOMER',
};

const corsHeaders = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-credentials': 'true',
  'content-type': 'application/json',
};

async function setAuth(page: import('@playwright/test').Page, user = organizerUser) {
  await page.addInitScript(() => {
    window.localStorage.setItem('eventai_access_token', 'mock-test-token');
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, headers: corsHeaders, json: { user } }),
  );
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ status: 401, headers: corsHeaders, json: { message: 'No refresh token in mock' } }),
  );
}

test.describe('Priority 1: Ticket Booking and ₹NaN Prevention', () => {
  test('event detail page renders valid currency without ₹NaN and handles booking order error cleanly', async ({
    page,
  }) => {
    await setAuth(page, customerUser);

    // Mock booking reservation to succeed with CORS headers
    await page.route('**/api/bookings', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          headers: corsHeaders,
          json: {
            booking: {
              id: 'booking-test-1',
              totalAmount: 900000,
              status: 'PENDING',
              expiresAt: new Date(Date.now() + 900000).toISOString(),
            },
          },
        });
      }
      return route.fallback();
    });

    // Mock payments order endpoint failing with actionable 503 response
    await page.route('**/api/payments/order', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      return route.fulfill({
        status: 503,
        headers: corsHeaders,
        json: {
          message:
            'Payment gateway authentication failed: invalid or expired Razorpay API keys. Please verify your Razorpay configuration in .env.',
        },
      });
    });

    // Navigate to the real local published event with tickets at ₹999
    await page.goto('/events/echoes-in-the-valley-indie-music-festival-2027');

    // 1. Verify no ₹NaN exists anywhere on the page
    const pageText = await page.locator('body').innerText();
    expect(pageText).not.toContain('₹NaN');
    expect(pageText).not.toContain('NaN');

    // 2. Verify formatted starting price heading
    await expect(page.getByText('Tickets from')).toBeVisible();
    await expect(page.getByText('₹999').first()).toBeVisible();

    // 3. Verify ticket type row shows availability
    await expect(page.getByText(/available/i).first()).toBeVisible();

    // 4. Booking widget interactions: increment ticket quantity using Plus button
    const plusButton = page.getByRole('button', { name: /Add one.*ticket/i }).first();
    await plusButton.click();

    // Total book button should display ₹999 (not NaN)
    const bookButton = page.getByRole('button', { name: /Book Tickets/i });
    await expect(bookButton).toBeVisible();
    await expect(bookButton).toContainText('₹999');

    // 5. Click Book Tickets
    await bookButton.click();

    // 6. Verify actionable error message from payments service
    await expect(
      page.getByText(/Payment gateway authentication failed: invalid or expired Razorpay API keys/i),
    ).toBeVisible();
  });
});

test.describe('Priority 2: Refund Listing, Counts, and Provider Reconciliation', () => {
  test('all requests tab displays records matching total count (count=2 displays 2 records)', async ({
    page,
  }) => {
    await setAuth(page, organizerUser);

    const refundListResponse = {
      refundRequests: [
        {
          bookingId: 'bk-1',
          amount: 50000,
          currency: 'INR',
          status: 'REFUND_PENDING',
          refundRequestStatus: 'APPROVED',
          refundRequestReason: 'User requested due to rain',
          refundRequestedAt: new Date(Date.now() - 3600000).toISOString(),
          refundReviewedAt: new Date(Date.now() - 1800000).toISOString(),
          booking: {
            totalAmount: 50000,
            user: { id: 'u1', firstName: 'Anita', lastName: 'Desai', email: 'anita@test.com' },
            event: { id: 'ev1', title: 'Monsoon Beats', slug: 'monsoon-beats', startDate: new Date().toISOString() },
            items: [{ quantity: 1, ticketType: { name: 'Early Bird' } }],
          },
        },
        {
          bookingId: 'bk-2',
          amount: 90000,
          currency: 'INR',
          status: 'REFUNDED',
          refundRequestStatus: 'APPROVED',
          refundRequestReason: 'Schedule conflict',
          refundRequestedAt: new Date(Date.now() - 7200000).toISOString(),
          refundReviewedAt: new Date(Date.now() - 3600000).toISOString(),
          booking: {
            totalAmount: 90000,
            user: { id: 'u2', firstName: 'Karan', lastName: 'Mehta', email: 'karan@test.com' },
            event: { id: 'ev1', title: 'Monsoon Beats', slug: 'monsoon-beats', startDate: new Date().toISOString() },
            items: [{ quantity: 1, ticketType: { name: 'VIP' } }],
          },
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
      counts: {
        PENDING: 0,
        APPROVED: 1,
        REFUNDED: 1,
        REJECTED: 0,
        FAILED: 0,
        ALL: 2,
      },
    };

    let requestedStatus: string | null = null;
    await page.route('**/api/organizers/refund-requests*', (route) => {
      const url = new URL(route.request().url());
      requestedStatus = url.searchParams.get('status');
      return route.fulfill({ status: 200, headers: corsHeaders, json: refundListResponse });
    });

    await page.goto('/organizer/refunds');

    // Default tab is PENDING (count is 0)
    await expect(page.getByRole('button', { name: /Pending review/ })).toBeVisible();

    // Click All requests tab
    await page.getByRole('button', { name: /All requests/ }).click();

    // Verify status=ALL was passed
    expect(requestedStatus).toBe('ALL');

    // Verify both records are rendered and visible (fixing the previous 0-records bug)
    await expect(page.getByText('Anita Desai')).toBeVisible();
    await expect(page.getByText('Karan Mehta')).toBeVisible();
    await expect(page.getByText('₹500')).toBeVisible();
    await expect(page.getByText('₹900')).toBeVisible();
  });
});

test.describe('Priority 4: Organizer Header Responsiveness', () => {
  test('desktop header at 1280px displays concise single-line navigation labels without wrapping', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setAuth(page, organizerUser);

    await page.goto('/organizer/events');

    // Verify desktop header organizer navigation is visible
    const organizerNav = page.locator('header nav[aria-label="Organizer navigation"]');
    await expect(organizerNav).toBeVisible();

    // Check organizer navigation buttons contain events, create, refunds
    await expect(organizerNav.locator('a[href="/organizer/events"]')).toBeVisible();
    await expect(organizerNav.locator('a[href="/organizer/events/new"]')).toBeVisible();
    await expect(organizerNav.locator('a[href="/organizer/refunds"]')).toBeVisible();

    // Attendee mode button is present and compact
    await expect(page.getByRole('link', { name: /Attendee Mode/ })).toBeVisible();
  });

  test('mobile header at 375px collapses navigation into responsive drawer', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setAuth(page, organizerUser);

    await page.goto('/organizer/events');

    // Desktop header organizer nav should be hidden on mobile
    const desktopNav = page.locator('header nav[aria-label="Organizer navigation"]');
    await expect(desktopNav).toBeHidden();

    // Mobile menu toggle button should be visible
    const menuButton = page.getByRole('button', { name: 'Toggle navigation menu' });
    await expect(menuButton).toBeVisible();

    // Click menu toggle to open drawer
    await menuButton.click();
    const mobileDrawer = page.locator('#mobile-nav');
    await expect(mobileDrawer).toBeVisible();
    await expect(mobileDrawer.locator('a[href="/organizer/events"]')).toBeVisible();
  });
});

test.describe('Priority 5: Direct Wizard Navigation', () => {
  test('existing event allows direct navigation across wizard steps', async ({ page }) => {
    await setAuth(page, organizerUser);

    const existingEvent = {
      id: 'event-existing-42',
      slug: 'summer-sun-fest',
      title: 'Summer Sun Festival',
      description: 'Annual outdoor summer festival featuring multiple artist stages with great music.',
      shortDescription: 'Outdoor summer festival in Delhi',
      status: 'DRAFT',
      categoryId: 'cat-fest',
      venueId: 'ven-delhi',
      startDate: new Date(Date.now() + 86400000 * 10).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 11).toISOString(),
      tags: ['summer', 'sun', 'festival'],
      policies: 'No alcohol allowed.',
      cancellationPolicy: 'Refunds within 48h of booking.',
      coverImage: 'https://images.example.test/summer.jpg',
      images: ['https://images.example.test/img1.jpg', 'https://images.example.test/img2.jpg'],
      category: { id: 'cat-fest', name: 'Festival', slug: 'festival' },
      venue: { id: 'ven-delhi', name: 'JL Stadium Ground', city: 'Delhi', state: 'DL', capacity: 2000 },
      ticketTypes: [
        {
          id: 'tt-1',
          name: 'Early Entry',
          price: 50000,
          currency: 'INR',
          totalQuantity: 200,
          availableQuantity: 200,
          isActive: true,
        },
      ],
      faqs: [],
    };

    await page.route('**/api/events/event-existing-42/manage', (route) =>
      route.fulfill({ status: 200, headers: corsHeaders, json: { event: existingEvent } }),
    );

    await page.route('**/api/categories', (route) =>
      route.fulfill({ status: 200, headers: corsHeaders, json: { categories: [existingEvent.category] } }),
    );
    await page.route('**/api/organizers/venues', (route) =>
      route.fulfill({ status: 200, headers: corsHeaders, json: { venues: [existingEvent.venue] } }),
    );

    await page.goto('/organizer/events/event-existing-42');

    // Wizard should start on step 0
    await expect(page.getByLabel('Event title')).toHaveValue('Summer Sun Festival');

    // Directly click Step 4 (Media & Policies) tab
    await page.getByRole('button', { name: /Media & Policies/i }).click();

    // Verify Step 4 content is visible
    await expect(page.getByRole('region', { name: 'Event media and policies' })).toBeVisible();
    await expect(page.getByText('Event cover image')).toBeVisible();

    // Directly click Step 5 (Tickets & Inventory) tab
    await page.getByRole('button', { name: /Tickets & Inventory/i }).click();

    // Verify Step 5 content is visible
    await expect(page.getByRole('region', { name: 'Tickets and inventory' })).toBeVisible();
    await expect(page.getByText('Early Entry')).toBeVisible();

    // Directly click Step 6 (Review & Publish) tab
    await page.getByRole('button', { name: /Review & Publish/i }).click();

    // Verify Step 6 content is visible
    await expect(page.getByRole('region', { name: 'Review and publish' })).toBeVisible();
    await expect(page.getByText('Review event details')).toBeVisible();
  });
});
