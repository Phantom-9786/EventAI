import { Module } from '@nestjs/common';
import { OrganizersController } from './organizers.controller';
import { OrganizersService } from './organizers.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [OrganizersController],
  providers: [OrganizersService],
  exports: [OrganizersService],
})
export class OrganizersModule {}
