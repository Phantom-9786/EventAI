import { CacheService } from './cache.service';

const mockRedis = {
  status: 'ready',
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  eval: jest.fn(),
  set: jest.fn().mockResolvedValue('OK'),
  pttl: jest.fn(),
  zrem: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK'),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => mockRedis),
}));

describe('CacheService AI shared state', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses one atomic Redis script for user, global, and concurrency limits', async () => {
    mockRedis.eval.mockResolvedValue(0);
    const service = new CacheService({ get: () => 'redis://unit.test' } as never);
    await expect(service.consumeAiRequest('hashed-identity', 10, 120, 20, 'lease-id')).resolves.toEqual({
      allowed: true,
    });
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      3,
      'eventai:ai:user:hashed-identity',
      'eventai:ai:global:minute',
      'eventai:ai:concurrency',
      '10',
      '120',
      '20',
      expect.any(String),
      expect.any(String),
      'lease-id',
      '120000',
    );
  });

  it.each([[1, 'user'], [2, 'global'], [3, 'concurrency']] as const)(
    'maps Redis decision %s to a %s limit',
    async (code, reason) => {
      mockRedis.eval.mockResolvedValue(code);
      const service = new CacheService({ get: () => 'redis://unit.test' } as never);
      await expect(service.consumeAiRequest('hash', 1, 2, 3, 'lease')).resolves.toEqual({
        allowed: false,
        reason,
      });
    },
  );

  it('shares provider cooldowns with expiring Redis keys', async () => {
    mockRedis.pttl.mockResolvedValue(4000);
    const service = new CacheService({ get: () => 'redis://unit.test' } as never);
    await service.setProviderCooldown('hashed-provider-state', 4000);
    await expect(service.providerCooldownMs('hashed-provider-state')).resolves.toBe(4000);
    expect(mockRedis.set).toHaveBeenCalledWith('hashed-provider-state', '1', 'PX', 4000);
  });

  it('rejects required AI protection calls when Redis is not configured', async () => {
    const service = new CacheService({ get: () => undefined } as never);
    await expect(service.consumeAiRequest('hash', 1, 1, 1, 'lease')).rejects.toThrow('Redis unavailable');
  });
});
