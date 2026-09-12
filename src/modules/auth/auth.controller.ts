import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RoleCode } from '../../common/enums/domain.enums.js';
import { successResponse } from '../../common/utils/response.util.js';
import { CurrentUser, Public, Roles } from './decorators/auth.decorators.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';
import { JwtAuthGuard, RolesGuard } from './guards/auth.guards.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './types/auth.types.js';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send authentication OTP to phone or email' })
  @ApiOkResponse({ description: 'OTP sent (dev may include devOtp)' })
  async sendOtp(@Body() dto: SendOtpDto) {
    const data = await this.authService.sendOtp(dto);
    return successResponse(data, data.message);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and issue access/refresh tokens' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    const data = await this.authService.verifyOtp(dto, this.meta(req));
    return successResponse(data, 'OTP verified successfully');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Password login (primarily for Admin)' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const data = await this.authService.login(dto, this.meta(req));
    return successResponse(data, 'Login successful');
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const data = await this.authService.refresh(
      dto.refreshToken,
      this.meta(req),
    );
    return successResponse(data, 'Token refreshed');
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Logout and revoke current session' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: LogoutDto) {
    const data = await this.authService.logout(user, dto.refreshToken);
    return successResponse(data, data.message);
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.authService.me(user.id);
    return successResponse(data, 'Current user');
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Change password for authenticated user' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    const data = await this.authService.changePassword(user, dto);
    return successResponse(data, data.message);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset (does not reveal account existence)',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const data = await this.authService.forgotPassword(dto);
    return successResponse(data, data.message);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a one-time token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const data = await this.authService.resetPassword(dto);
    return successResponse(data, data.message);
  }

  @Get('admin-check')
  @ApiBearerAuth('bearer')
  @UseGuards(RolesGuard)
  @Roles(RoleCode.ADMIN, RoleCode.SUPER_ADMIN)
  @ApiOperation({
    summary: 'RBAC smoke check — Admin/Super Admin only (Phase 3 verification)',
  })
  adminCheck(@CurrentUser() user: AuthenticatedUser) {
    return successResponse(
      { ok: true, userId: user.id, roles: user.roles },
      'Admin access granted',
    );
  }

  private meta(req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : req.ip;
    return {
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    };
  }
}
