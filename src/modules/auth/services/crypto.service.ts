import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class CryptoService {
  constructor(private readonly configService: ConfigService) {}

  async hashPassword(password: string): Promise<string> {
    const rounds =
      this.configService.get<number>('security.bcryptSaltRounds') ?? 12;
    return bcrypt.hash(password, rounds);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateOtp(length = 6): string {
    const max = 10 ** length;
    const min = 10 ** (length - 1);
    return String(randomInt(min, max));
  }

  hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateSecureToken(bytes = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  async hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  async compareRefreshToken(token: string, hash: string): Promise<boolean> {
    return bcrypt.compare(token, hash);
  }
}
