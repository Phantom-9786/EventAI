import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { venueSearchSchema } from '@eventai/validation';
import type { VenueSearchInput } from '@eventai/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { VenuesService } from './venues.service';

@ApiTags('venues')
@Controller('venues')
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse venues (city/name filter, pagination)' })
  async search(@Query(new ZodValidationPipe(venueSearchSchema)) query: VenueSearchInput) {
    return this.venuesService.search({
      city: query.city,
      query: query.query,
      page: query.page,
      limit: query.limit,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a venue with its seat sections and organizer' })
  async getVenue(@Param('id', ParseUUIDPipe) id: string) {
    return { venue: await this.venuesService.getVenue(id) };
  }
}
