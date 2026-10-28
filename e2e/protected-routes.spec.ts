import { expect, test, type Page } from '@playwright/test';

type Role = 'CUSTOMER' | 'ORGANIZER' | 'ADMIN';

function pauseResponse() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** All API traffic stays in the browser mocks; no accounts or server data are changed. */
async function mockSession(
  page: Page,
  options: {
    role: Role | null;
    storedToken?: boolean;
    refreshWait?: Promise<void>;
    profileWait?: Promise<void>;
    adminWait?: Promise<void>;
    expireFirstProfile?: boolean;
  },
) {
  const requests: string[] = [];
  let profileCalls = 0;
  if (options.storedToken) {
    await page.addInitScript(() =>
      localStorage.setItem('eventai_access_token', 'fixture-token'),
    );
  }
  const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:3000')
    .origin;
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    requests.push(pathname);
    let status = 200;
    let json: unknown;
    if (pathname === '/api/auth/refresh') {
      await options.refreshWait;
      status = options.role ? 200 : 401;
      json = options.role ? { accessToken: 'fixture-token' } : { message: 'No session' };
    } else if (pathname === '/api/auth/me') {
      profileCalls += 1;
      if (options.expireFirstProfile && profileCalls === 1) {
        status = 401;
        json = { message: 'Expired token' };
      } else {
        await options.profileWait;
        status = options.role ? 200 : 401;
        json = {
          user: {
            id: 'fixture-user',
            email: 'user@eventai.test',
            firstName: 'Fixture',
            lastName: 'User',
            role: options.role,
            isEmailVerified: true,
          },
        };
      }
    } else if (pathname === '/api/notifications') {
      json = { notifications: [], unreadCount: 0 };
    } else if (pathname === '/api/admin/stats') {
      await options.adminWait;
      json = {
        users: 7,
        organizers: { total: 2, verified: 1 },
        events: { total: 3 },
        revenue: { net: 150000 },
        tickets: { issued: 5, checkedIn: 1 },
        bookings: { CONFIRMED: 2 },
      };
    } else if (pathname === '/api/categories') {
      json = { categories: [] };
    } else if (pathname === '/api/organizers/me') {
      status = options.role === 'ORGANIZER' ? 200 : 404;
      json = {
        organizer: {
          id: 'fixture-organizer',
          organizationName: 'Fixture Events',
          phone: null,
          applicationStatus: 'APPROVED',
          isVerified: true,
          _count: { events: 0, venues: 0 },
        },
      };
    } else if (pathname === '/api/organizers/me/stats') {
      json = {
        events: { total: 0 },
        revenue: 0,
        confirmedBookings: 0,
        refundedBookings: 0,
        ticketsIssued: 0,
        checkedIn: 0,
      };
    } else if (pathname === '/api/organizers/me/events') {
      json = { events: [], total: 0, page: 1, pages: 0 };
    } else {
      status = 500;
      json = { message: `Unexpected API request: ${pathname}` };
    }
    // A timeout test may have aborted this request before the mock is released.
    await route.fulfill({ status, headers, json }).catch((error: unknown) => {
      if (!route.request().failure()) throw error;
    });
  });
  return requests;
}

const protectedPages = [
  { path: '/dashboard', gate: 'Sign in to your Organizer Hub' },
  { path: '/admin', gate: 'Sign in as an admin to continue' },
];

for (const { path, gate } of protectedPages) {
  test(`direct ${path} navigation shows authentication progress, then the sign-in gate`, async ({
    page,
  }) => {
    const refresh = pauseResponse();
    const requests = await mockSession(page, {
      role: null,
      refreshWait: refresh.promise,
    });
    try {
      await page.goto(path);
      await expect(page.locator('main').getByRole('status')).toHaveText(
        path === '/dashboard' ? 'Checking credentials…' : 'Checking sign-in…',
      );
      await expect(
        page.getByRole('heading', { name: 'Discover. Book. Experience.' }),
      ).toHaveCount(0);
    } finally {
      refresh.release();
    }
    await expect(page.getByRole('heading', { name: gate, exact: true })).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: 'Sign In', exact: true }),
    ).toHaveAttribute(
      'href',
      path === '/dashboard' ? '/signin?returnUrl=/dashboard' : '/signin',
    );
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    expect(
      requests.some(
        (request) =>
          request.startsWith('/api/admin/') || request.startsWith('/api/organizers/'),
      ),
    ).toBe(false);
    await page.reload();
    await expect(page.getByRole('heading', { name: gate, exact: true })).toBeVisible();
  });

  test(`direct ${path} navigation with a stalled profile fails closed after the auth timeout`, async ({
    page,
  }) => {
    const profile = pauseResponse();
    await mockSession(page, {
      role: null,
      storedToken: true,
      profileWait: profile.promise,
    });
    try {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: gate, exact: true })).toBeVisible({
        timeout: 18000,
      });
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    } finally {
      profile.release();
    }
  });
}

for (const role of ['CUSTOMER', 'ORGANIZER'] as const) {
  test(`direct /admin navigation denies an authenticated ${role}`, async ({ page }) => {
    const requests = await mockSession(page, { role, storedToken: true });
    await page.goto('/admin');
    await expect(
      page.getByRole('heading', { name: 'Admins only', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Admin sections' })).toHaveCount(0);
    expect(
      requests.some(
        (request) => request.startsWith('/api/admin/') || request === '/api/categories',
      ),
    ).toBe(false);
    await expect(page).toHaveURL(/\/admin$/);
  });
}

test('direct /admin navigation restores an admin session and renders the admin interface', async ({
  page,
}) => {
  const data = pauseResponse();
  const requests = await mockSession(page, { role: 'ADMIN', adminWait: data.promise });
  try {
    await page.goto('/admin');
    await expect(page.locator('main').getByRole('status')).toHaveText(
      'Loading admin dashboard…',
    );
  } finally {
    data.release();
  }
  await expect(
    page.getByRole('heading', { name: 'A clear view of your platform.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin workspace' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Admin workspace' })
      .getByRole('link', { name: 'Bookings & payments' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create category', exact: true })).toBeVisible();
  expect(requests).toEqual(
    expect.arrayContaining([
      '/api/auth/refresh',
      '/api/auth/me',
      '/api/admin/stats',
      '/api/categories',
    ]),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'A clear view of your platform.', exact: true }),
  ).toBeVisible();
});

test('a stalled profile retry after token refresh also fails closed', async ({
  page,
}) => {
  const profile = pauseResponse();
  const requests = await mockSession(page, {
    role: 'ADMIN',
    storedToken: true,
    expireFirstProfile: true,
    profileWait: profile.promise,
  });
  try {
    await page.goto('/admin');
    await expect(
      page.getByRole('heading', { name: 'Sign in as an admin to continue', exact: true }),
    ).toBeVisible({ timeout: 18000 });
    expect(requests).toContain('/api/auth/refresh');
    expect(
      requests.filter((request) => request === '/api/auth/me').length,
    ).toBeGreaterThanOrEqual(2);
    expect(requests).not.toContain('/api/admin/stats');
  } finally {
    profile.release();
  }
});

test('direct /dashboard navigation renders the organizer dashboard after authentication', async ({
  page,
}) => {
  await mockSession(page, { role: 'ORGANIZER' });
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Bring good people together.', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('main').getByRole('link', { name: 'Manage Events', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('direct /dashboard navigation keeps customer organizer onboarding available', async ({
  page,
}) => {
  await mockSession(page, { role: 'CUSTOMER', storedToken: true });
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Become an event organizer', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Register Organizer Account' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
});
