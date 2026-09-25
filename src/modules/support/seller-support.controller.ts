import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupportRequesterType } from '../../generated/prisma/client.js';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../auth/index.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';
import {
  CreateSupportTicketDto,
  ReplySupportTicketDto,
  SupportTicketsQueryDto,
} from './support.dto.js';
import { SupportService } from './support.service.js';

@ApiTags('Seller Support')
@Controller({ path: 'seller/support/tickets', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class SellerSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({ summary: 'List my support tickets' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SupportTicketsQueryDto,
  ) {
    const { items, meta } = await this.support.listMine(
      user.id,
      SupportRequesterType.SELLER,
      query,
    );
    return successResponse(items, 'Support tickets retrieved', meta);
  }

  @Post()
  @ApiOperation({ summary: 'Raise a support ticket' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return successResponse(
      await this.support.create(user.id, SupportRequesterType.SELLER, dto),
      'Support ticket created',
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a support ticket' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return successResponse(
      await this.support.getMine(user.id, SupportRequesterType.SELLER, id),
      'Support ticket retrieved',
    );
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a support ticket' })
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplySupportTicketDto,
  ) {
    return successResponse(
      await this.support.replyMine(
        user.id,
        SupportRequesterType.SELLER,
        id,
        dto,
      ),
      'Reply added',
    );
  }
}
