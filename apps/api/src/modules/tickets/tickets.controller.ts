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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTicketTypeSchema,
  updateTicketTypeSchema,
} from '@eventai/validation';
import type {
  CreateTicketTypeInput,
  UpdateTicketTypeInput,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrganizersService } from '../organizers/organizers.service';
import { TicketsService } from './tickets.service';

@ApiTags('events')
@Controller()
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly organizersService: OrganizersService,
  ) {}

  @Roles('ORGANIZER')
  @Post('events/:idOrSlug/tickets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a ticket type to your event (organizer only)' })
  async create(
    @CurrentUser('id') userId: string,
    @Param('idOrSlug') idOrSlug: string,
    @Body(new ZodValidationPipe(createTicketTypeSchema)) body: CreateTicketTypeInput,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { ticketType: await this.ticketsService.create(organizerId, idOrSlug, body) };
  }

  @Roles('ORGANIZER')
  @Get('events/:idOrSlug/tickets')
  @ApiOperation({ summary: 'List all ticket types of your event, including inactive (organizer only)' })
  async list(
    @CurrentUser('id') userId: string,
    @Param('idOrSlug') idOrSlug: string,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { ticketTypes: await this.ticketsService.listForOrganizer(organizerId, idOrSlug) };
  }

  @Roles('ORGANIZER')
  @Patch('ticket-types/:id')
  @ApiOperation({ summary: 'Update a ticket type of your event (organizer only)' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTicketTypeSchema)) body: UpdateTicketTypeInput,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { ticketType: await this.ticketsService.update(organizerId, id, body) };
  }

  @Roles('ORGANIZER')
  @Delete('ticket-types/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an unbooked ticket type (organizer only)' })
  async remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.ticketsService.remove(organizerId, id);
  }
}
