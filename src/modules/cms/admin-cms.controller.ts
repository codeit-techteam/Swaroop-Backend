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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import { ADMIN_CORE_ROLES } from '../admin/common/admin-roles.js';
import {
  CmsBannerQueryDto,
  CreateCmsBannerDto,
  CreateCmsMediaUploadDto,
  UpdateCmsBannerDto,
} from './cms.dto.js';
import { CmsService } from './cms.service.js';

@ApiTags('Admin CMS')
@Controller({ path: 'admin/cms/banners', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(...ADMIN_CORE_ROLES)
export class AdminCmsController {
  constructor(private readonly cms: CmsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create CMS banner (mediaKey optional, R2 not required)',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCmsBannerDto,
  ) {
    return successResponse(
      await this.cms.create(dto, user.id),
      'Banner created',
    );
  }

  @Post('media-upload')
  @ApiOperation({
    summary: 'Signed upload URL for a banner creative (requires object storage)',
  })
  async mediaUpload(@Body() dto: CreateCmsMediaUploadDto) {
    return successResponse(
      await this.cms.createMediaUpload(dto),
      'Upload URL created',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List CMS banners' })
  async list(@Query() query: CmsBannerQueryDto) {
    const { items, meta } = await this.cms.list(query);
    return successResponse(items, 'Banners retrieved', meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get CMS banner' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return successResponse(await this.cms.findOne(id), 'Banner retrieved');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update CMS banner' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsBannerDto,
  ) {
    return successResponse(
      await this.cms.update(id, dto, user.id),
      'Banner updated',
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete CMS banner' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.cms.remove(id, user.id),
      'Banner deleted',
    );
  }
}
