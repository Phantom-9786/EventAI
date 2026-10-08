import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEventSchema,
  eventSearchSchema,
  updateEventSchema,
} from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrganizersService } from '../organizers/organizers.service';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly organizersService: OrganizersService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search published events (FTS query, filters, sorting, pagination)' })
  async search(@Query(new ZodValidationPipe(eventSearchSchema)) query: Record<string, unknown>) {
    return this.eventsService.searchEvents(
      query as unknown as Parameters<EventsService['searchEvents']>[0],
    );
  }

  @Public()
  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Get a published event by id or slug' })
  async getPublished(@Param('idOrSlug') idOrSlug: string) {
    return { event: await this.eventsService.getPublishedEvent(idOrSlug) };
  }

  @Roles('ORGANIZER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a draft event (organizer only)' })
  async create(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(createEventSchema))
    body: {
      title: string;
      description: string;
      shortDescription?: string;
      categoryId: string;
      venueId: string;
      startDate: string;
      endDate: string;
      tags?: string[];
      policies?: string;
      cancellationPolicy?: string;
    },
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { event: await this.eventsService.createEvent(organizerId, body) };
  }

  @Roles('ORGANIZER')
  @Get(':idOrSlug/manage')
  @ApiOperation({ summary: 'Get one of your events including drafts (organizer only)' })
  async getForManage(@CurrentUser('id') userId: string, @Param('idOrSlug') idOrSlug: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { event: await this.eventsService.getEventForManage(organizerId, idOrSlug) };
  }

  @Roles('ORGANIZER')
  @Patch(':idOrSlug')
  @ApiOperation({ summary: 'Update your event (organizer only)' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('idOrSlug') idOrSlug: string,
    @Body(new ZodValidationPipe(updateEventSchema))
    body: Record<string, unknown>,
  ) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return {
      event: await this.eventsService.updateEvent(
        organizerId,
        idOrSlug,
        body as unknown as Parameters<EventsService['updateEvent']>[2],
      ),
    };
  }

  @Roles('ORGANIZER')
  @Post(':idOrSlug/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a draft event (organizer only)' })
  async publish(@CurrentUser('id') userId: string, @Param('idOrSlug') idOrSlug: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { event: await this.eventsService.publishEvent(organizerId, idOrSlug) };
  }

  @Roles('ORGANIZER')
  @Post(':idOrSlug/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a draft or published event (organizer only)' })
  async cancel(@CurrentUser('id') userId: string, @Param('idOrSlug') idOrSlug: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return { event: await this.eventsService.cancelEvent(organizerId, idOrSlug) };
  }

  @Roles('ORGANIZER')
  @Delete(':idOrSlug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a draft event (organizer only)' })
  async remove(@CurrentUser('id') userId: string, @Param('idOrSlug') idOrSlug: string) {
    const organizerId = await this.organizersService.requireOrganizerId(userId);
    return this.eventsService.deleteEvent(organizerId, idOrSlug);
  }
}
