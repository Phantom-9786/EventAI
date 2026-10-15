import {
  Controller,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { EventMediaService, MAX_EVENT_IMAGE_BYTES } from './event-media.service';

@ApiTags('events')
@Controller('events')
@Roles('ORGANIZER')
export class EventMediaController {
  constructor(private readonly media: EventMediaService) {}

  @Post(':eventId/images')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image for an owned event (JPEG, PNG, WebP; max 5 MB)' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_EVENT_IMAGE_BYTES, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentUser('id') userId: string,
    @Param('eventId') eventId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.media.upload(userId, eventId, file);
  }

  @Post('upload-image')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an event image (JPEG, PNG, WebP; max 5 MB)' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_EVENT_IMAGE_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadGeneric(
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.media.uploadGeneric(userId, file);
  }
}
