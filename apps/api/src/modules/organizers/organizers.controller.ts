import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  becomeOrganizerSchema,
  createVenueSchema,
  paginationSchema,
} from '@eventai/validation';
import type { CreateVenueInput } from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrganizersService } from './organizers.service';

@ApiTags('organizer')
@Controller('organizers')
export class OrganizersController {
  constructor(private readonly organizersService: OrganizersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an organizer profile (upgrades the account to ORGANIZER)' })
  async becomeOrganizer(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(becomeOrganizerSchema))
    body: { organizationName: string; description?: string; website?: string; phone?: string },
  ) {
    return { organizer: await this.organizersService.becomeOrganizer(userId, body) };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated organizer profile' })
  async getMe(@CurrentUser('id') userId: string) {
    return { organizer: await this.organizersService.getOwnOrganizerProfile(userId) };
  }

  @Get('me/events')
  @ApiOperation({ summary: 'List the authenticated organizer events (all statuses)' })
  async listOwnEvents(
    @CurrentUser('id') userId: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: { page: number; limit: number },
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.organizersService.listOwnEvents(organizerId, query.page, query.limit);
  }

  @Post('venues')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a venue owned by the authenticated organizer' })
  async createVenue(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(createVenueSchema)) body: CreateVenueInput,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { venue: await this.organizersService.createVenue(organizerId, body) };
  }

  @Get('venues')
  @ApiOperation({ summary: 'List venues owned by the authenticated organizer' })
  async listVenues(@CurrentUser('id') userId: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { venues: await this.organizersService.listOwnVenues(organizerId) };
  }
}
