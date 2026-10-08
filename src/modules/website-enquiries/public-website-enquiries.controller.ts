import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { successResponse } from '../../common/utils/response.util.js';
import { CreateWebsiteEnquiryDto } from './website-enquiries.dto.js';
import { WebsiteEnquiriesService } from './website-enquiries.service.js';

function clientIp(request: Request): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  const first =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : undefined;
  return first || request.ip || request.socket.remoteAddress || undefined;
}

@ApiTags('Public Website')
@Controller({ path: 'public/enquiries', version: '1' })
export class PublicWebsiteEnquiriesController {
  constructor(private readonly enquiries: WebsiteEnquiriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a contact enquiry from the public website' })
  async create(@Body() dto: CreateWebsiteEnquiryDto, @Req() request: Request) {
    const userAgent = request.headers['user-agent'];
    return successResponse(
      await this.enquiries.create(dto, {
        ipAddress: clientIp(request),
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      }),
      'Enquiry received',
    );
  }
}
