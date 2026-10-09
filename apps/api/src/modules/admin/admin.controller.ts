import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Roles('ADMIN')
  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide statistics (admin only)' })
  async stats() {
    return this.adminService.platformStats();
  }
}
