import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { aiChatSchema } from '@eventai/validation';
import type { AiChatInput } from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { AiService } from './ai.service';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Public()
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chat with the EventAI assistant (grounded in the live catalog)' })
  async chat(@Body(new ZodValidationPipe(aiChatSchema)) body: AiChatInput) {
    return {
      configured: this.aiService.isConfigured(),
      reply: await this.aiService.chat(body.messages),
    };
  }
}
