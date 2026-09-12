import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export enum AuthOtpPurpose {
  LOGIN = 'LOGIN',
  SIGNUP = 'SIGNUP',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PHONE_VERIFICATION = 'PHONE_VERIFICATION',
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
}

export class SendOtpDto {
  @ApiPropertyOptional({ example: '+919876543210' })
  @ValidateIf((o: SendOtpDto) => !o.email)
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be in E.164 format, e.g. +919876543210',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((o: SendOtpDto) => !o.phone)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: AuthOtpPurpose, default: AuthOtpPurpose.LOGIN })
  @IsOptional()
  @IsEnum(AuthOtpPurpose)
  purpose?: AuthOtpPurpose = AuthOtpPurpose.LOGIN;
}

export class VerifyOtpDto {
  @ApiPropertyOptional({ example: '+919876543210' })
  @ValidateIf((o: VerifyOtpDto) => !o.email)
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((o: VerifyOtpDto) => !o.phone)
  @IsEmail()
  email?: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(4)
  @MaxLength(8)
  otp!: string;

  @ApiProperty({ enum: AuthOtpPurpose, example: AuthOtpPurpose.LOGIN })
  @IsEnum(AuthOtpPurpose)
  purpose!: AuthOtpPurpose;

  @ApiPropertyOptional({
    description: 'Optional role hint for first-time signup (CUSTOMER|SELLER)',
    example: 'CUSTOMER',
  })
  @IsOptional()
  @IsString()
  roleHint?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@test.local' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Admin@12345' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Optional refresh token to revoke; defaults to current session',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'newPassword must include uppercase, lowercase, and a number (min 8 chars)',
  })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((o: ForgotPasswordDto) => !o.phone)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @ValidateIf((o: ForgotPasswordDto) => !o.email)
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone?: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'newPassword must include uppercase, lowercase, and a number (min 8 chars)',
  })
  newPassword!: string;
}
