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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  becomeOrganizerSchema,
  createSeatSectionSchema,
  createVenueSchema,
  paginationSchema,
  updateVenueSchema,
} from '@eventai/validation';
import type {
  CreateSeatSectionInput,
  CreateVenueInput,
  UpdateVenueInput,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { validateTicketSchema } from '@eventai/validation';
import type { ValidateTicketInput } from '@eventai/validation';
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

  @Get('me/stats')
  @ApiOperation({ summary: 'Dashboard aggregates for the authenticated organizer' })
  async getDashboardStats(@CurrentUser('id') userId: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.organizersService.getDashboardStats(organizerId);
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

  @Roles('ORGANIZER')
  @Patch('venues/:venueId')
  @ApiOperation({ summary: 'Update a venue you own (organizer only)' })
  async updateVenue(
    @CurrentUser('id') userId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body(new ZodValidationPipe(updateVenueSchema)) body: UpdateVenueInput,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { venue: await this.organizersService.updateVenue(organizerId, venueId, body) };
  }

  @Roles('ORGANIZER')
  @Delete('venues/:venueId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a venue you own — only when it has no events (organizer only)' })
  async deleteVenue(
    @CurrentUser('id') userId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.organizersService.deleteVenue(organizerId, venueId);
  }

  @Roles('ORGANIZER')
  @Post('venues/:venueId/sections')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a seat section (rows x seats-per-row) to a venue you own' })
  async createSeatSection(
    @CurrentUser('id') userId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
    @Body(new ZodValidationPipe(createSeatSectionSchema)) body: CreateSeatSectionInput,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return {
      section: await this.organizersService.createSeatSection(organizerId, venueId, body),
    };
  }

  @Roles('ORGANIZER')
  @Get('venues/:venueId/sections')
  @ApiOperation({ summary: 'List seat sections of a venue you own' })
  async listSeatSections(
    @CurrentUser('id') userId: string,
    @Param('venueId', ParseUUIDPipe) venueId: string,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return {
      sections: await this.organizersService.listSeatSections(organizerId, venueId),
    };
  }

  @Roles('ORGANIZER')
  @Post('events/:eventId/tickets/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check in a ticket by its code at the door (organizer only)' })
  async validateTicket(
    @CurrentUser('id') userId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodValidationPipe(validateTicketSchema)) body: ValidateTicketInput,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.organizersService.validateTicket(organizerId, eventId, body.ticketCode);
  }

  @Roles('ORGANIZER')
  @Get('events/:eventId/tickets/stats')
  @ApiOperation({ summary: 'Ticket check-in summary for one of your events (organizer only)' })
  async eventTicketStats(
    @CurrentUser('id') userId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.organizersService.eventTicketStats(organizerId, eventId);
  }
}
