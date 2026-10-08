import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    })
      .useMocker((token) => {
        if (token === PrismaService) return prisma;
        return jest.fn();
      })
      .compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should report ok status with database up', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('eventai-api');
    expect(result.dependencies.database).toBe('up');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('should report database down when the query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const result = await controller.check();
    expect(result.dependencies.database).toBe('down');
    expect(result.status).toBe('ok');
  });
});
