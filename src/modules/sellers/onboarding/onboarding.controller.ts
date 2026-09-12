import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { successResponse } from '../../../common/utils/response.util.js';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorators.js';
import { JwtAuthGuard, RolesGuard } from '../../auth/index.js';
import type { AuthenticatedUser } from '../../auth/types/auth.types.js';
import { CreateOnboardingDto, UpdateOnboardingDto } from './onboarding.dto.js';
import { OnboardingService } from './onboarding.service.js';

@ApiTags('Seller Onboarding')
@Controller({ path: 'seller/onboarding', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('bearer')
@Roles(RoleCode.SELLER)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post()
  @ApiOperation({ summary: 'Start or upsert seller onboarding' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOnboardingDto,
  ) {
    const data = await this.onboardingService.create(user.id, dto, user);
    return successResponse(data, 'Onboarding started');
  }

  @Get()
  @ApiOperation({ summary: 'Get seller onboarding payload' })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingService.get(user.id),
      'Onboarding retrieved',
    );
  }

  @Patch()
  @ApiOperation({ summary: 'Update onboarding draft' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOnboardingDto,
  ) {
    return successResponse(
      await this.onboardingService.update(user.id, dto),
      'Onboarding updated',
    );
  }

  @Post('submit')
  @ApiOperation({ summary: 'Submit onboarding for admin review' })
  async submit(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingService.submit(user.id),
      'Onboarding submitted',
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Get onboarding status' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      await this.onboardingService.status(user.id),
      'Onboarding status',
    );
  }
}
