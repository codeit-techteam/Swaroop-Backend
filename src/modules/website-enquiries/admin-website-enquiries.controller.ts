import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { ADMIN_SUPPORT_ROLES } from '../admin/common/admin-roles.js';
import {
  UpdateWebsiteEnquiryDto,
  WebsiteEnquiriesQueryDto,
} from './website-enquiries.dto.js';
import { WebsiteEnquiriesService } from './website-enquiries.service.js';

@ApiTags('Admin Website Enquiries')
@Controller({ path: 'admin/enquiries', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_SUPPORT_ROLES)
export class AdminWebsiteEnquiriesController {
  constructor(private readonly enquiries: WebsiteEnquiriesService) {}

  @Get()
  @ApiOperation({ summary: 'List website contact enquiries' })
  async list(@Query() query: WebsiteEnquiriesQueryDto) {
    const { items, meta } = await this.enquiries.listAdmin(query);
    return successResponse(items, 'Website enquiries retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a website enquiry' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(
      await this.enquiries.getAdmin(id),
      'Website enquiry retrieved',
    );
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update enquiry status or internal notes' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebsiteEnquiryDto,
  ) {
    return successResponse(
      await this.enquiries.updateAdmin(
        id,
        { id: user.id, firstName: user.firstName, lastName: user.lastName },
        dto,
      ),
      'Website enquiry updated',
    );
  }
}
