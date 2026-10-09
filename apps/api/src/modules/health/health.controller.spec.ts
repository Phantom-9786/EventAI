import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let cache: { ping: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    cache = {
      ping: jest.fn().mockResolvedValue('up'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    })
      .useMocker((token) => {
        if (token === PrismaService) return prisma;
        if (token === CacheService) return cache;
        return jest.fn();
      })
      .compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should report ok status with database and redis up', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('eventai-api');
    expect(result.dependencies.database).toBe('up');
    expect(result.dependencies.redis).toBe('up');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('should report database down when the query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const result = await controller.check();
    expect(result.dependencies.database).toBe('down');
    expect(result.status).toBe('ok');
  });

  it('should report redis down when ping fails', async () => {
    cache.ping.mockResolvedValue('down');
    const result = await controller.check();
    expect(result.dependencies.redis).toBe('down');
    expect(result.dependencies.database).toBe('up');
  });
});
