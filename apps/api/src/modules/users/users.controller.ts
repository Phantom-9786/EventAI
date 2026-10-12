import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  deleteAccountSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  async getMe(@CurrentUser('id') userId: string) {
    return { user: await this.usersService.getOwnProfile(userId) };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(updateProfileSchema))
    body: {
      firstName?: string;
      lastName?: string;
      username?: string | null;
      bio?: string | null;
      location?: string | null;
    },
  ) {
    return { user: await this.usersService.updateProfile(userId, body) };
  }

  @Patch('me/preferences')
  @ApiOperation({ summary: 'Merge keys into the user preference map' })
  async updatePreferences(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(updatePreferencesSchema))
    body: { preferences: Record<string, string | number | boolean> },
  ) {
    return this.usersService.updatePreferences(userId, body.preferences);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a profile image (max 5 MB, JPEG/PNG/WebP/GIF)' })
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.usersService.saveAvatar(userId, file);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate the authenticated account and revoke all sessions' })
  async deactivateAccount(@CurrentUser('id') userId: string) {
    return this.usersService.deactivateAccount(userId);
  }

  @Post('me/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete and anonymize account with explicit confirmation' })
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(deleteAccountSchema)) body: { confirmation: string },
  ) {
    return this.usersService.deleteAccount(userId, body.confirmation);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a public profile by user id' })
  async getPublicProfile(@Param('id', ParseUUIDPipe) id: string) {
    return { user: await this.usersService.getPublicProfile(id) };
  }
}
