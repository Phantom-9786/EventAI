import { test, expect, type Page } from '@playwright/test';
import { homeSearchDestination } from '../apps/web/src/lib/home-search';

test('AI recommendations show compact cards in the centered workspace', async ({
  page,
  request,
}) => {
  const { events } = await (
    await request.get('http://localhost:4000/api/events?limit=4')
  ).json();
  await session(page);
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ json: { reply: 'Choose an event to explore.', events } }),
  );
  await page.goto('/ai');
  await page.getByRole('button', { name: /What’s coming up/ }).click();
  await expect(page.locator('.ep-ai-event-card')).toHaveCount(4);
  const sizes = await page.locator('.ep-chat-results').evaluate((el) => ({
    columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
    cards: [...el.children].map((c) => ({
      width: c.getBoundingClientRect().width,
      height: c.getBoundingClientRect().height,
    })),
  }));
  const answer = page.locator('.ep-chat-message.assistant').last();
  const introBounds = await answer.locator('.ep-chat-bubble').boundingBox();
  const cardBounds = await answer.locator('.ep-chat-results').boundingBox();
  expect(introBounds!.y + introBounds!.height).toBeLessThanOrEqual(cardBounds!.y);
  expect(sizes.columns).toBe(3);
  expect(sizes.cards.every((c) => c.width < 270 && c.height < 260)).toBe(true);
});

test('system controls have one page title and a clear section hierarchy', async ({
  page,
}) => {
  await session(page, 'ADMIN');
  await page.route('**/api/admin/system-controls', (route) =>
    route.fulfill({
      json: {
        settings: {
          websiteMaintenance: false,
          aiMaintenance: false,
          eventCreationMaintenance: false,
        },
      },
    }),
  );
  await page.goto('/admin?tab=system-controls');
  await expect(
    page.getByRole('heading', { name: 'System Controls', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Website Maintenance Mode', exact: true }),
  ).toBeVisible();
});

test('local sample gallery has selectable thumbnails and keeps all event sections', async ({
  page,
  request,
}) => {
  const { events } = await (
    await request.get('http://localhost:4000/api/events?limit=1')
  ).json();
  await session(page);
  await page.goto('/events/' + events[0].slug);
  const second = page.getByRole('button', { name: 'View photo 2', exact: true });
  await expect(second).toBeVisible();
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'View event image full size' }).click();
  await expect(page.getByRole('dialog', { name: /image gallery/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Event sections' })
    .getByRole('link', { name: 'Venue', exact: true })
    .click();
  await expect(page).toHaveURL(/#venue$/);
  await expect(page.locator('#about')).toBeAttached();
  await expect(page.locator('#venue')).toBeAttached();
  await expect(page.locator('#faq')).toBeAttached();
});

test('compact calendar fits the viewport and date plans link to events', async ({
  page,
}) => {
  await session(page);
  await bookingFixture(page);
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/calendar');
  await expect(page.getByRole('region', { name: 'Booking calendar' })).toBeVisible();
  const bounds = await page.locator('.ep-calendar').boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
  const now = new Date();
  const label =
    new Date(now.getFullYear(), now.getMonth(), 20).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }) + ', 1 events';
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(
    page.getByRole('link', { name: /Calendar music fixture.*View event/ }),
  ).toHaveAttribute('href', '/events/fixture-event');
});

test('AI inspiration fits short screens without scrolling its panel', async ({
  page,
}) => {
  await session(page);
  await page.setViewportSize({ width: 1280, height: 650 });
  await page.goto('/ai');
  const panel = page.getByRole('complementary', { name: 'Explore with AI' });
  await expect(panel.getByRole('button', { name: /Find music events/i })).toBeVisible();
  const bounds = await panel.evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.height + 1);
});

test('venue page displays only its events with working event links', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const { events } = await (
    await request.get('http://localhost:4000/api/events?limit=1')
  ).json();
  const event = events[0];
  const venueId = event.venue.id;
  const response = await request.get(
    'http://localhost:4000/api/events?venueId=' + venueId,
  );
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.events.length).toBeGreaterThan(0);
  expect(
    data.events.every((entry: { venue: { id: string } }) => entry.venue.id === venueId),
  ).toBe(true);
  await session(page);
  await page.route('**/api/events?venueId=**', (route) => route.fulfill({ json: data }));
  await page.goto('/venues/' + venueId);
  await expect(page.locator('.leaflet-container')).toBeVisible();
  expect(pageErrors).toEqual([]);
  await expect(
    page.getByRole('heading', { name: 'Events at this venue.' }),
  ).toBeVisible();
  await page
    .locator('.ep-venue-events')
    .getByRole('heading', { name: event.title, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp('/events/' + event.slug + '$'));
});

test('organization settings save public details separately from personal account', async ({
  page,
}) => {
  await session(page, 'ADMIN');
  let payload: Record<string, unknown> = {};
  await page.route('**/api/organizers/me', (route) => {
    if (route.request().method() === 'PATCH') payload = route.request().postDataJSON();
    return route.fulfill({
      json: {
        organizer: {
          id: 'own-org',
          organizationName: payload.organizationName || 'Existing organization',
          website: null,
          phone: null,
          description: null,
          isVerified: true,
          _count: { events: 0, venues: 0 },
        },
      },
    });
  });
  await page.goto('/organizer/settings');
  await page
    .getByLabel('Organization name', { exact: true })
    .fill('Updated local organization');
  await page.getByLabel('Organization website').fill('https://example.test');
  await page.getByRole('button', { name: 'Save organization' }).click();
  await expect(page.getByRole('status')).toContainText('Organization details saved.');
  expect(payload).toMatchObject({
    organizationName: 'Updated local organization',
    website: 'https://example.test',
  });
  expect(payload).not.toHaveProperty('role');
  await expect(
    page.getByRole('link', { name: 'Personal profile', exact: true }),
  ).toHaveAttribute('href', '/account');
});

test('home search classification handles synonyms, typos, city and complex requests', () => {
  const categories = [
    { name: 'Music', slug: 'music' },
    { name: 'Food & Drink', slug: 'food-and-drink' },
    { name: 'Technology', slug: 'technology' },
  ];
  expect(homeSearchDestination('musci', categories)).toBe('/events?category=music');
  expect(homeSearchDestination('concerts', categories, 'Mumbai')).toBe(
    '/events?category=music&city=Mumbai',
  );
  expect(homeSearchDestination('food', categories)).toBe(
    '/events?category=food-and-drink',
  );
  expect(homeSearchDestination('tech events', categories)).toBe(
    '/events?category=technology',
  );
  expect(homeSearchDestination('music under 1000 this weekend', categories)).toContain(
    '/ai?prompt=',
  );
  expect(homeSearchDestination('something fun for a date', categories)).toContain(
    '/ai?prompt=',
  );
  expect(homeSearchDestination('music', [])).toContain('/ai?prompt=');
});

async function bookingFixture(page: Page) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 20, 18);
  const end = new Date(now.getFullYear(), now.getMonth(), 20, 22);
  await page.route('**/api/bookings?**', (route) =>
    route.fulfill({
      json: {
        bookings: [
          {
            id: 'fixture-booking',
            status: 'CONFIRMED',
            totalAmount: 100000,
            expiresAt: null,
            event: {
              id: 'fixture-event',
              slug: 'fixture-event',
              title: 'Calendar music fixture',
              startDate: start.toISOString(),
              endDate: end.toISOString(),
              status: 'PUBLISHED',
              venue: { name: 'Test venue', city: 'Bengaluru' },
            },
            items: [
              {
                id: 'fixture-item',
                quantity: 1,
                ticketType: { name: 'General', price: 100000 },
              },
            ],
            tickets: [
              {
                id: 'fixture-ticket',
                ticketCode: 'FIXTURE-ONLY',
                holderName: 'Test attendee',
                status: 'USED',
              },
            ],
          },
        ],
        total: 1,
        pages: 1,
      },
    }),
  );
}

test('bookings and digital tickets have separate destinations', async ({ page }) => {
  await session(page);
  await bookingFixture(page);
  await page.goto('/bookings');
  await expect(
    page.getByRole('heading', { name: 'My bookings', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: /View digital tickets/ }).click();
  await expect(page).toHaveURL(/\/tickets\?booking=fixture-booking/);
  await expect(
    page.getByRole('heading', { name: 'Your digital tickets.' }),
  ).toBeVisible();
  await expect(page.getByText('FIXTURE-ONLY', { exact: false }).first()).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Attendee workspace' })
      .getByRole('link', { name: 'My bookings', exact: true }),
  ).toBeVisible();
});

test('calendar shows confirmed bookings on their actual dates', async ({ page }) => {
  await session(page);
  await bookingFixture(page);
  await page.goto('/calendar');
  await expect(
    page.getByRole('heading', { name: 'Your plans, on the calendar.' }),
  ).toBeVisible();
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), 20);
  const label =
    day.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ', 1 events';
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Calendar music fixture' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByText('No confirmed events on this date.')).toBeVisible();
});

test('simple category home search opens filtered Discover', async ({ page }) => {
  await session(page);
  await page.goto('/');
  await page
    .getByRole('searchbox', { name: 'Describe the events you want' })
    .fill('Music');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/\/events\?category=music/);
});

test('AI inspiration buttons start a conversation', async ({ page }) => {
  await session(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  let prompt = '';
  await page.route('**/api/ai/chat', (route) => {
    prompt = route.request().postDataJSON().messages.at(-1).content;
    return route.fulfill({ json: { reply: 'Here are budget ideas.', events: [] } });
  });
  await page.goto('/ai');
  await page.getByRole('button', { name: /Find music events/i }).click();
  await expect(page.getByRole('log')).toContainText('Here are budget ideas.');
  expect(prompt).toContain('Music');
});

test('event chat expansion preserves conversation and route', async ({
  page,
  request,
}) => {
  const { events } = await (
    await request.get('http://localhost:4000/api/events?limit=1')
  ).json();
  await session(page);
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ json: { reply: 'A retained event answer.', events: [] } }),
  );
  await page.goto('/events/' + events[0].slug);
  await page
    .getByRole('textbox', { name: 'Ask about this event', exact: true })
    .fill('Explain tickets');
  await page.getByRole('button', { name: 'Send event question', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('A retained event answer.');
  await page.getByRole('button', { name: 'Expand chat' }).click();
  await expect(page.getByRole('dialog', { name: 'Chat about this event' })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('A retained event answer.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Chat about this event' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('log')).toContainText('A retained event answer.');
  await expect(page).toHaveURL(new RegExp('/events/' + events[0].slug + '$'));
});

async function session(page: Page, role = 'CUSTOMER') {
  await page.addInitScript(() => {
    localStorage.setItem('eventai_access_token', 'local-ui-test');
    localStorage.setItem('eventai_theme', 'light');
  });
  let items = [
    {
      id: 'read-1',
      title: 'Past update',
      message: 'Previously viewed update',
      isRead: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'new-1',
      title: 'Booking confirmed',
      message: 'Your tickets are ready',
      isRead: false,
      createdAt: new Date().toISOString(),
    },
  ];
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: unknown = {};
    if (p === '/api/auth/me')
      json = {
        user: {
          id: 'ui-user',
          firstName: 'Aarav',
          lastName: 'Sharma',
          email: 'ui@example.test',
          role,
          isEmailVerified: true,
        },
      };
    else if (p === '/api/notifications/read' && method === 'DELETE') {
      items = items.filter((n) => !n.isRead);
      json = { success: true };
    } else if (p === '/api/notifications')
      json = { notifications: items, unreadCount: items.filter((n) => !n.isRead).length };
    else if (p === '/api/organizers/me/stats')
      json = {
        events: { total: 2, PUBLISHED: 1, DRAFT: 1 },
        revenue: 100000,
        confirmedBookings: 4,
        refundedBookings: 0,
        ticketsIssued: 8,
        checkedIn: 2,
      };
    else if (p === '/api/organizers/me/events')
      json = {
        events: [{ id: 'event-1', title: 'Local test event' }],
        total: 1,
        pages: 1,
      };
    else if (p === '/api/organizers/events/event-1/bookings')
      json = {
        bookings: [
          {
            id: 'booking-1',
            status: 'CONFIRMED',
            user: {
              email: 'attendee@example.test',
              firstName: 'Test',
              lastName: 'Attendee',
            },
            tickets: [{ id: 'ticket-1', status: 'USED' }],
            items: [],
          },
        ],
        total: 1,
        pages: 1,
      };
    else if (p === '/api/organizers/me/venues') json = { venues: [] };
    else if (p === '/api/bookings') json = { bookings: [], total: 0, pages: 0 };
    else if (p === '/api/admin/stats')
      json = {
        users: 1,
        organizers: { total: 0, verified: 0 },
        events: { total: 0 },
        revenue: { net: 0 },
        tickets: { issued: 0, checkedIn: 0 },
        bookings: {},
      };
    else if (p === '/api/admin/users') json = { users: [], total: 0, pages: 0 };
    else if (p === '/api/ai/suggestions')
      json = {
        suggestions: [
          { title: 'Upcoming events', prompt: 'Show upcoming events' },
          { title: 'Music', prompt: 'Show Music events' },
        ],
      };
    else if (p === '/api/categories') json = { categories: [] };
    else if (p === '/api/system-controls') json = { controls: {} };
    await route.fulfill({
      json,
      headers: {
        'access-control-allow-origin': 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
      },
    });
  });
}

test('attendee overview has real destinations, no admin action, and persistent sidebar', async ({
  page,
}) => {
  await session(page);
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: /Your next story/ })).toBeVisible();
  await expect(
    page.locator('header').getByRole('link', { name: 'Admin', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Upcoming plans/ })).toHaveAttribute(
    'href',
    '/calendar',
  );
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Attendee workspace' })
      .getByRole('link', { name: 'My bookings' }),
  ).toBeVisible();
});

test('bell refreshes and clears read notifications while retaining unread items', async ({
  page,
}) => {
  await session(page);
  await page.goto('/overview');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('Past update', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh notifications' }).click();
  await page.getByRole('button', { name: 'Clear read', exact: true }).click();
  await expect(page.getByText('Past update', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Booking confirmed', { exact: true })).toBeVisible();
});

test('admin sidebar changes the actual admin section', async ({ page }) => {
  await session(page, 'ADMIN');
  await page.goto('/admin');
  await expect(
    page.locator('header').getByRole('link', { name: 'Admin', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Admin workspace' })
    .getByRole('link', { name: 'Users', exact: true })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Admin workspace' })
      .getByRole('link', { name: 'Users', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('tablist', { name: 'Admin sections' })).toHaveCount(0);
});

for (const width of [390, 768, 1440])
  test('workspace fits viewport ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await session(page);
    await page.goto('/overview');
    await expect(page.getByRole('heading', { name: /Your next story/ })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

test('organizer analytics displays backend totals and attendee destination', async ({
  page,
}) => {
  await session(page, 'ORGANIZER');
  await page.goto('/organizer/analytics');
  await expect(
    page.getByRole('heading', { name: 'Your events, in perspective.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Confirmed bookings/ })).toHaveAttribute(
    'href',
    '/organizer/attendees',
  );
  await expect(page.getByText('Check-in rate: 25% · 2 events')).toBeVisible();
});

test('organizer roster loads owned event bookings and exports the displayed page', async ({
  page,
}) => {
  await session(page, 'ORGANIZER');
  await page.goto('/organizer/attendees');
  await expect(page.getByText('attendee@example.test', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this page' }).click();
  expect((await download).suggestedFilename()).toBe('eventpoint-attendees-page-1.csv');
  await page.getByRole('textbox', { name: 'Search this page' }).fill('no match');
  await expect(page.getByText('No attendees found on this page.')).toBeVisible();
});

test('home AI prompt is sent once when the AI page opens', async ({ page }) => {
  await session(page);
  let count = 0;
  await page.route('**/api/ai/chat', (route) => {
    count++;
    return route.fulfill({ json: { reply: 'Weekend ideas ready.', events: [] } });
  });
  await page.goto('/ai?prompt=Music%20this%20weekend');
  await expect(page.getByRole('log')).toContainText('Weekend ideas ready.');
  expect(count).toBe(1);
});

test('approved preview layout dimensions and dashboard entry are preserved', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await session(page, 'ORGANIZER');
  await page.goto('/overview');
  await expect(
    page.getByRole('heading', { name: 'Your next story starts here.', exact: true }),
  ).toBeVisible();
  const sizes = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace')!,
      header = document.querySelector('.header')!,
      stat = document.querySelector('.stat')!,
      heading = document.querySelector('.page-head h1')!;
    return {
      width: workspace.getBoundingClientRect().width,
      columns: getComputedStyle(workspace).gridTemplateColumns,
      header: header.getBoundingClientRect().height,
      font: getComputedStyle(workspace).fontFamily,
      padding: getComputedStyle(stat).padding,
      fontSize: getComputedStyle(heading).fontSize,
    };
  });
  expect(sizes).toMatchObject({
    width: 1376,
    columns: '235px 1109px',
    header: 86,
    padding: '22px',
    fontSize: '32px',
  });
  expect(sizes.font).toContain('DM Sans');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(16, 16, 16)');
  await page.setViewportSize({ width: 768, height: 1000 });
  await expect(
    page.locator('header').getByRole('link', { name: 'My Dashboard', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle navigation menu' })).toHaveCount(
    0,
  );
});

test('complex home search navigates to AI and starts the request', async ({ page }) => {
  await session(page);
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ json: { reply: 'Matching music for your plans.', events: [] } }),
  );
  await page.goto('/');
  await page
    .getByRole('searchbox', { name: 'Describe the events you want' })
    .fill('Music under 1000 this weekend');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/\/ai\?prompt=/);
  await expect(page.getByRole('log')).toContainText('Matching music for your plans.');
});

test('AI composer stays visible while long messages scroll internally', async ({
  page,
}) => {
  await session(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ json: { reply: 'A helpful answer. '.repeat(400), events: [] } }),
  );
  await page.goto('/ai');
  await page.getByRole('textbox', { name: 'Ask the EventPoint AI' }).fill('Find music');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log')).toContainText('A helpful answer.');
  const input = await page
    .getByRole('textbox', { name: 'Ask the EventPoint AI' })
    .boundingBox();
  expect(input!.y).toBeGreaterThan(0);
  expect(input!.y + input!.height).toBeLessThanOrEqual(720);
  expect(
    await page.getByRole('log').evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
});

test('AI failures finish loading and leave the composer available', async ({ page }) => {
  await session(page);
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({ status: 503, json: { message: 'Please try later.' } }),
  );
  await page.goto('/ai');
  await page.getByRole('textbox', { name: 'Ask the EventPoint AI' }).fill('Find music');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.ep-chat-error')).toContainText('Please try later.');
  await expect(
    page.getByRole('textbox', { name: 'Ask the EventPoint AI' }),
  ).toBeEnabled();
});

test('saved events stay within attendee dashboard', async ({ page }) => {
  await session(page);
  await page.goto('/overview');
  await page
    .getByRole('navigation', { name: 'Attendee workspace' })
    .getByRole('link', { name: 'Saved events' })
    .click();
  await expect(page).toHaveURL(/\/overview\?view=saved$/);
  await expect(
    page.getByRole('heading', { name: 'Your saved experiences.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Attendee workspace' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Save something to look forward to.' }),
  ).toBeVisible();
});

test('organizers get a switch action with separated icon and label', async ({ page }) => {
  await session(page, 'ORGANIZER');
  await page.goto('/overview');
  const link = page.getByRole('link', { name: 'Switch to organizer', exact: true });
  await expect(link).toBeVisible();
  const gap = await link.evaluate((el) => {
    const a = el.querySelector('svg')!.getBoundingClientRect(),
      b = el.querySelector('span')!.getBoundingClientRect();
    return b.left - a.right;
  });
  expect(gap).toBeGreaterThanOrEqual(8);
});

test('saved event cards load in the dashboard and remain removable', async ({ page }) => {
  await session(page);
  await page.addInitScript(() =>
    localStorage.setItem('eventpoint_favorites_list', JSON.stringify(['saved-one'])),
  );
  await page.route('**/api/events/saved-one', (route) =>
    route.fulfill({
      json: {
        event: {
          id: 'saved-one',
          slug: 'saved-fixture',
          title: 'Saved music evening',
          images: [],
          coverImage: null,
          startDate: '2027-11-20T12:00:00Z',
          endDate: '2027-11-20T18:00:00Z',
          category: { name: 'Music', slug: 'music' },
          venue: { name: 'Local venue', city: 'Bengaluru' },
          organizer: { organizationName: 'Local organizer' },
          ticketTypes: [{ price: 100000 }],
        },
      },
    }),
  );
  await page.goto('/overview?view=saved');
  await expect(page.getByRole('heading', { name: 'Saved music evening' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Attendee workspace' })
      .getByRole('link', { name: 'Saved events' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /Remove.*saved/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Save something to look forward to.' }),
  ).toBeVisible();
});

test('pending organizer sees application status action instead of onboarding again', async ({
  page,
}) => {
  await session(page);
  await page.route('**/api/organizers/me', (route) =>
    route.fulfill({
      json: {
        organizer: { id: 'pending', applicationStatus: 'PENDING', isVerified: false },
      },
    }),
  );
  await page.goto('/overview');
  await expect(
    page.getByRole('link', { name: 'Organizer application', exact: true }),
  ).toHaveAttribute('href', '/dashboard');
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
});

test('local published event chat stays on the event route and sends its context', async ({
  page,
  request,
}) => {
  const data = await (
    await request.get('http://localhost:4000/api/events?limit=1')
  ).json();
  const event = data.events[0];
  expect(event).toBeTruthy();
  await session(page);
  let eventId = '';
  await page.route('**/api/ai/chat', (route) => {
    eventId = route.request().postDataJSON().eventId;
    return route.fulfill({
      json: { reply: 'The published policy applies to this event.', events: [] },
    });
  });
  await page.goto('/events/' + event.slug);
  await page
    .getByRole('textbox', { name: 'Ask about this event', exact: true })
    .fill('What is the cancellation policy?');
  await page.getByRole('button', { name: 'Send event question', exact: true }).click();
  await expect(page.getByRole('log')).toContainText(
    'The published policy applies to this event.',
  );
  expect(eventId).toBe(event.id);
  await expect(page).toHaveURL(new RegExp('/events/' + event.slug + '$'));
  await page.getByRole('button', { name: 'Close event chat' }).click();
  await expect(page.getByLabel('Event chat panel')).toHaveCount(0);
});

test('tickets are grouped by event with every pass visible and no selector', async ({
  page,
}) => {
  await session(page);
  const event = (id: string) => ({
    id,
    slug: id,
    title: 'Test event ' + id,
    startDate: '2027-02-20T12:00:00Z',
    endDate: '2027-02-20T16:00:00Z',
    venue: { name: 'Test venue', city: 'Mumbai' },
  });
  const booking = (id: string, eventId: string, count: number) => ({
    id,
    event: event(eventId),
    status: 'CONFIRMED',
    items: [
      { quantity: count, ticketType: { id: 'general', name: 'General', price: 10000 } },
    ],
    tickets: Array.from({ length: count }, (_, i) => ({
      id: id + i,
      ticketTypeId: 'general',
      ticketCode: id + '-PASS-' + i,
      holderName: 'Test attendee',
      status: 'VALID',
    })),
  });
  await page.route('**/api/bookings?**', (route) =>
    route.fulfill({
      json: {
        bookings: [
          booking('first', 'one', 2),
          booking('second', 'one', 1),
          booking('third', 'two', 1),
        ],
        pages: 1,
        total: 3,
      },
    }),
  );
  await page.goto('/tickets');
  await expect(page.locator('.ep-ticket-event-group')).toHaveCount(2);
  await expect(
    page.locator('.ep-ticket-event-group').first().getByText('General', { exact: true }),
  ).toHaveCount(3);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText('third-PASS-0', { exact: true })).toBeAttached();
  await page.screenshot({
    path: process.env.TEMP + '/eventpoint-grouped-tickets.png',
    fullPage: true,
  });
});

test('AI welcome starts at the top with recommendation cards', async ({ page }) => {
  await session(page);
  await page.goto('/ai');
  const ideas = page.getByRole('complementary', { name: 'Explore with AI' });
  await expect(
    ideas.getByRole('heading', { name: 'Suggested for you to ask' }),
  ).toBeVisible();
  await expect(ideas.getByRole('button', { name: /Find music events/i })).toBeVisible();
  const log = await page.getByRole('log').boundingBox();
  const welcome = await page.locator('.ep-ai-welcome').boundingBox();
  expect(welcome!.y - log!.y).toBeLessThan(35);
  await page.screenshot({
    path: process.env.TEMP + '/eventpoint-ai-recommendations.png',
  });
});

test('venue map enlarges in a dialog and Escape closes it', async ({ page, request }) => {
  const { events } = await (
    await request.get('http://localhost:4000/api/events?limit=1')
  ).json();
  await session(page);
  await page.goto('/venues/' + events[0].venue.id);
  const expand = page.getByRole('button', { name: 'Enlarge venue map' });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: /Map of/ });
  await expect(dialog).toBeVisible();
  const map = await dialog.locator('.leaflet-container').boundingBox();
  expect(map!.width).toBeGreaterThan(600);
  expect(map!.height).toBeGreaterThan(400);
  await page.screenshot({ path: process.env.TEMP + '/eventpoint-map-expanded.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();
});

test('owner can invite an administrator and see a pending invitation', async ({
  page,
}) => {
  await session(page, 'ADMIN');
  let submitted: unknown;
  let invitations: unknown[] = [];
  await page.route('**/api/admin/team', (route) =>
    route.fulfill({
      json: {
        currentUser: { id: 'ui-user', isOwner: true, role: 'OWNER' },
        members: [],
        invitations,
      },
    }),
  );
  await page.route('**/api/admin/team/invitations', (route) => {
    submitted = route.request().postDataJSON();
    invitations = [
      {
        id: 'invite-1',
        email: 'colleague@example.test',
        role: 'ADMIN',
        status: 'PENDING',
        expiresAt: '2027-01-01T00:00:00Z',
        createdAt: new Date().toISOString(),
        invitedBy: { email: 'owner@example.test', fullName: 'Owner' },
        acceptedAt: null,
        acceptedBy: null,
      },
    ];
    return route.fulfill({
      json: { success: true, invitation: invitations[0], emailDeliveryFailed: false },
    });
  });
  await page.goto('/admin?tab=team');
  await expect(
    page.getByRole('button', { name: 'Invite Administrator', exact: true }),
  ).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Invite Administrator', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Email Address').fill('colleague@example.test');
  await expect(modal.getByText('Administrator', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(page.getByRole('status')).toContainText('Invitation sent');
  expect(submitted).toEqual({ email: 'colleague@example.test', role: 'ADMIN' });
  await expect(page.getByText('colleague@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Delegated Admin', { exact: true })).toHaveCount(0);
});

for (const width of [390, 768, 1280, 1440])
  test('event moderation has no horizontal scrolling ' + width, async ({ page }) => {
    await session(page, 'ADMIN');
    await page.setViewportSize({ width, height: 850 });
    await page.route('**/api/admin/events?**', (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: 'event-1',
              title:
                'A long event title: National Software Architecture and Engineering Summit',
              status: 'PUBLISHED',
              organizerEmail: 'long-organization-address@example.test',
              venue: { name: 'International Convention Centre', city: 'Hyderabad' },
              moderation: { status: 'APPROVED' },
              bookingCount: 12,
            },
          ],
          total: 1,
          pages: 1,
        },
      }),
    );
    await page.goto('/admin?tab=events');
    await expect(page.getByRole('button', { name: 'Cancel Event' })).toBeVisible();
    const sizes = await page.locator('.ep-moderation-list').evaluate((el) => ({
      w: el.clientWidth,
      s: el.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(sizes.s).toBeLessThanOrEqual(sizes.w + 1);
    expect(sizes.document).toBeLessThanOrEqual(sizes.viewport + 1);
    await page.screenshot({
      path: process.env.TEMP + '/eventpoint-moderation-' + width + '.png',
    });
  });

test('admin preview button opens an image-rich preview and pause can be resumed', async ({
  page,
  request,
}) => {
  const { events } = await (
    await request.get('http://localhost:4000/api/events?limit=1')
  ).json();
  const { event } = await (
    await request.get('http://localhost:4000/api/events/' + events[0].slug)
  ).json();
  const row = {
    ...event,
    organizerEmail: 'organizer@example.test',
    bookingCount: 3,
    moderation: { status: 'APPROVED' },
  };
  const detail = {
    ...row,
    organizer: {
      ...event.organizer,
      user: {
        id: 'organizer',
        firstName: 'Test',
        lastName: 'Organizer',
        email: 'organizer@example.test',
      },
    },
  };
  await session(page, 'ADMIN');
  await page.route('**/api/admin/events?**', (route) =>
    route.fulfill({ json: { events: [row], total: 1, pages: 1 } }),
  );
  await page.route('**/api/admin/events/' + event.id, (route) =>
    route.fulfill({ json: { event: detail } }),
  );
  const actions: string[] = [];
  await page.route('**/api/admin/events/' + event.id + '/moderate', (route) => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    row.status = body.action === 'PAUSE' ? 'PAUSED' : 'PUBLISHED';
    return route.fulfill({ json: { id: event.id, status: row.status } });
  });
  await page.goto('/admin?tab=events');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog');
  await expect(
    preview.getByRole('button', { name: 'View photo 2', exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole('link', { name: 'Open event page' })).toHaveAttribute(
    'href',
    '/events/' + event.slug,
  );
  await expect
    .poll(
      () =>
        preview
          .locator('.gallery-main img')
          .evaluate((img: HTMLImageElement) => img.naturalWidth)
          .catch(() => 0),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await preview.locator('.gallery-main img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.screenshot({
    path: process.env.TEMP + '/eventpoint-admin-rich-preview.png',
  });
  await preview.getByRole('button', { name: 'Close modal' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Pause Event', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Resume Event', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  expect(actions).toEqual(['PAUSE', 'RESUME']);
});
