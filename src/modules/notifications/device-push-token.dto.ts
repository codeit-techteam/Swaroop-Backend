import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const FCM_TOKEN = /^[A-Za-z0-9_:-]{32,4096}$/;
const INSTALLATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const PREVIOUS_TOKEN =
  /^(?:[A-Za-z0-9_:-]{32,4096}|(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\])$/;

export class RegisterDevicePushTokenDto {
  @IsString()
  @Matches(FCM_TOKEN, { message: 'token must be an FCM device token' })
  token!: string;

  @IsIn(['android'])
  platform!: 'android';

  @IsString()
  @Matches(INSTALLATION_ID, { message: 'installationId is invalid' })
  installationId!: string;

  @IsOptional()
  @IsString()
  @Matches(PREVIOUS_TOKEN, { message: 'previousToken is invalid' })
  previousToken?: string;
}

export class RevokeDevicePushTokenDto {
  @IsString()
  @Matches(PREVIOUS_TOKEN, { message: 'token must be an FCM device token' })
  token!: string;
}
