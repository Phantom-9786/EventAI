import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns HTTP 200 when PostgreSQL is available', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const cache = { ping: jest.fn().mockResolvedValue('up') };
    const response = { status: jest.fn() };
    const controller = new HealthController(prisma as never, cache as never);

    const result = await controller.check(response as never);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(result.status).toBe('ok');
    expect(result.dependencies.database).toBe('up');
  });

  it('returns HTTP 503 when PostgreSQL is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const cache = { ping: jest.fn().mockResolvedValue('up') };
    const response = { status: jest.fn() };
    const controller = new HealthController(prisma as never, cache as never);

    const result = await controller.check(response as never);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(result.status).toBe('error');
    expect(result.dependencies.database).toBe('down');
  });
});
