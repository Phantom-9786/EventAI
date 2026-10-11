import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRequestGuard } from './ai-request.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

@Module({
  controllers: [AiController],
  providers: [AiService, AiRequestGuard, OptionalJwtAuthGuard],
  exports: [AiService],
})
export class AiModule {}
