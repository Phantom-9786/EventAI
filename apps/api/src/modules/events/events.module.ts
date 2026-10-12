import { Module } from '@nestjs/common';
import { OrganizersModule } from '../organizers/organizers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventMediaController } from './event-media.controller';
import { EventMediaService } from './event-media.service';

@Module({
  imports: [OrganizersModule, NotificationsModule],
  controllers: [EventsController, EventMediaController],
  providers: [EventsService, EventMediaService],
  exports: [EventsService, EventMediaService],
})
export class EventsModule {}
