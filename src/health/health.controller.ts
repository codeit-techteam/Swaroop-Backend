import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { API_TAGS } from '../common/constants/app.constants.js';
import { successResponse } from '../common/utils/response.util.js';
import { HealthService } from './health.service.js';

@ApiTags(API_TAGS.HEALTH)
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Infrastructure health check',
    description:
      'Returns application availability and database connectivity status. Not a business API.',
  })
  @ApiOkResponse({ description: 'Service health status' })
  async getHealth() {
    const data = await this.healthService.check();
    return successResponse(data, 'Health check completed');
  }
}
