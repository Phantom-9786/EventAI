import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { OrganizersModule } from '../organizers/organizers.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [EventsModule, OrganizersModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
