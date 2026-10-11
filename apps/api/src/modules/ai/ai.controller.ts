import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { aiChatSchema } from '@eventai/validation';
import type { AiChatInput } from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { AiService } from './ai.service';
import { AiRequestGuard } from './ai-request.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Public()
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  // Replaced by the shared Redis-backed guard so limits apply across replicas.
  @SkipThrottle()
  @UseGuards(OptionalJwtAuthGuard, AiRequestGuard)
  @ApiOperation({ summary: 'Chat with the EventAI assistant (grounded in the live catalog)' })
  async chat(@Body(new ZodValidationPipe(aiChatSchema)) body: AiChatInput) {
    const result = await this.aiService.chat(body.messages);
    return {
      configured: this.aiService.isConfigured(),
      reply: result.reply,
      events: result.events,
    };
  }
}
