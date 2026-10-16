import { resolveTestDatabaseUrl } from '../../test/db';

describe('destructive integration database guard', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('does not fall back to DATABASE_URL', () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://fixture:fixture@localhost:5432/eventai_test';
    expect(resolveTestDatabaseUrl).toThrow();
  });

  it.each([
    'postgresql://fixture:fixture@shared.example.test/eventai_test',
    'postgresql://fixture:fixture@localhost/eventai',
    'postgresql://fixture:fixture@localhost/test_staging',
    'postgresql://fixture:fixture@localhost/eventai_test?host=shared.example.test',
    'postgresql://fixture:fixture@localhost/eventai_test?schema=public',
  ])('refuses unsafe targets without exposing the URL: %s', (url) => {
    process.env.TEST_DATABASE_URL = url;
    process.env.TEST_DATABASE_RESET_ALLOWED = '1';
    expect(resolveTestDatabaseUrl).toThrow('Refusing database reset');
  });

  it('requires explicit destructive setup consent even for loopback', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:5432/eventai_test';
    delete process.env.TEST_DATABASE_RESET_ALLOWED;
    expect(resolveTestDatabaseUrl).toThrow('Refusing database reset');
    process.env.TEST_DATABASE_RESET_ALLOWED = '1';
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });
});
