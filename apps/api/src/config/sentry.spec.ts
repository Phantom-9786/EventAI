import * as Sentry from '@sentry/node';
import { initSentry, isSentryConfigured, scrubSentryEvent } from './sentry';

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

const REAL_DSN = 'https://abc123def456@o123456.ingest.sentry.io/7654321';

describe('isSentryConfigured', () => {
  it('is false for missing, empty, placeholder, or malformed DSNs', () => {
    expect(isSentryConfigured(undefined)).toBe(false);
    expect(isSentryConfigured('')).toBe(false);
    expect(isSentryConfigured('https://xxxx@sentry.io/xxxx')).toBe(false);
    expect(isSentryConfigured('not-a-dsn')).toBe(false);
  });

  it('is true for a real DSN shape', () => {
    expect(isSentryConfigured(REAL_DSN)).toBe(true);
  });
});

describe('initSentry', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('never initializes the SDK when no DSN is configured (graceful disable)', () => {
    expect(initSentry({ NODE_ENV: 'development' })).toBe(false);
    expect(initSentry({ SENTRY_DSN: 'https://xxxx@sentry.io/xxxx' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes with the DSN, a scrubbing beforeSend, and low PII defaults', () => {
    const enabled = initSentry({ SENTRY_DSN: REAL_DSN, SENTRY_ENVIRONMENT: 'staging' });

    expect(enabled).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(options.dsn).toBe(REAL_DSN);
    expect(options.environment).toBe('staging');
    expect(options.sendDefaultPii).toBeUndefined();
    expect(typeof options.beforeSend).toBe('function');
  });

  it('defaults the environment to NODE_ENV when SENTRY_ENVIRONMENT is unset', () => {
    initSentry({ SENTRY_DSN: REAL_DSN, NODE_ENV: 'production' });
    const options = (Sentry.init as jest.Mock).mock.calls[0][0];
    expect(options.environment).toBe('production');
  });
});

describe('scrubSentryEvent', () => {
  it('removes auth/cookie headers, query strings, and cookies', () => {
    const event = {
      request: {
        url: 'https://api.eventai.test/api/payments/verify',
        query_string: 'bookingId=abc',
        cookies: { refresh_token: 'r-123' },
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'refresh=cookie-value',
          'content-type': 'application/json',
          'x-request-id': 'req-42',
        },
      },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event)!;

    expect(scrubbed.request!.query_string).toBeUndefined();
    expect(scrubbed.request!.cookies).toBeUndefined();
    const headers = scrubbed.request!.headers as Record<string, unknown>;
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers['content-type']).toBe('application/json');
    expect(scrubbed.tags!.request_id).toBe('req-42');
  });

  it('redacts sensitive keys inside request data and extras', () => {
    const event = {
      request: {
        data: {
          password: 'hunter2',
          resetToken: 'tok-123',
          amount: 49900,
          nested: { cardNumber: '4111111111111111', note: 'ok' },
        },
      },
      extra: { GROQ_API_KEY: 'gsk-secret', attempts: 2 },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event)!;

    const data = scrubbed.request!.data as Record<string, unknown>;
    expect(data.password).toBe('[Filtered]');
    expect(data.resetToken).toBe('[Filtered]');
    expect(data.amount).toBe(49900);
    expect((data.nested as Record<string, unknown>).cardNumber).toBe('[Filtered]');
    expect((data.nested as Record<string, unknown>).note).toBe('ok');
    expect(scrubbed.extra!.GROQ_API_KEY).toBe('[Filtered]');
    expect(scrubbed.extra!.attempts).toBe(2);
  });

  it('redacts payment signatures, ticket credentials, and contact fields', () => {
    const event = {
      request: {
        data: {
          razorpay_signature: 'signature-value',
          ticketCode: 'ticket-value',
          qrData: 'qr-value',
          holderName: 'Attendee Name',
          email: 'attendee@example.test',
          phone: '5550100',
          eventTitle: 'Public Event',
        },
      },
      message: 'signature=signature-value ticketCode=ticket-value email=attendee@example.test',
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event)!;
    const data = scrubbed.request!.data as Record<string, unknown>;
    expect(data.razorpay_signature).toBe('[Filtered]');
    expect(data.ticketCode).toBe('[Filtered]');
    expect(data.qrData).toBe('[Filtered]');
    expect(data.holderName).toBe('[Filtered]');
    expect(data.email).toBe('[Filtered]');
    expect(data.phone).toBe('[Filtered]');
    expect(data.eventTitle).toBe('Public Event');
    expect(scrubbed.message).not.toContain('signature-value');
    expect(scrubbed.message).not.toContain('ticket-value');
    expect(scrubbed.message).not.toContain('attendee@example.test');
  });

  it('keeps ordinary error details and never returns null for valid events', () => {
    const event = {
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      message: 'boom',
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event)!;

    expect(scrubbed).not.toBeNull();
    expect(scrubbed.message).toBe('boom');
    expect(scrubbed.exception!.values![0].value).toBe('boom');
  });

  it('scrubs URL queries, credential-like text, breadcrumbs, contexts, and user PII', () => {
    const event = {
      request: { url: 'https://api.eventai.test/pay?resetToken=hidden#fragment' },
      exception: { values: [{ type: 'Error', value: 'Authorization: Bearer hidden-token' }] },
      breadcrumbs: [{ message: 'token=hidden-token', data: { apiKey: 'hidden' } }],
      contexts: { payment: { cardNumber: 'hidden' } },
      user: { id: 'user-1', email: 'person@example.test', ip_address: '127.0.0.1' },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubSentryEvent(event)!;
    expect(scrubbed.request?.url).toBe('https://api.eventai.test/pay');
    expect(scrubbed.exception?.values?.[0].value).not.toContain('hidden-token');
    expect(scrubbed.breadcrumbs?.[0].message).toBe('token=[Filtered]');
    expect((scrubbed.contexts?.payment as Record<string, unknown>).cardNumber).toBe('[Filtered]');
    expect(scrubbed.user?.email).toBeUndefined();
    expect(scrubbed.user?.ip_address).toBeUndefined();
  });
});
