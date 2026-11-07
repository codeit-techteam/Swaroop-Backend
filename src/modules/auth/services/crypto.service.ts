import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomInt,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
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

  /**
   * Cryptographically secure numeric OTP, zero-padded to `length`
   * (full range 000000–999999 for length 6).
   */
  generateOtp(length = 6): string {
    const digits = Math.min(9, Math.max(4, length));
    const max = 10 ** digits;
    return String(randomInt(0, max)).padStart(digits, '0');
  }

  /**
   * Keyed hash (HMAC-SHA256) of a locally generated OTP. A 6-digit OTP has only
   * 10^6 values, so an unkeyed hash would be trivially reversible if the table
   * leaked; keying it with a server secret prevents offline recovery.
   */
  hashOtp(otp: string): string {
    const secret =
      this.configService.get<string>('security.jwtAccessSecret') ?? '';
    return createHmac('sha256', secret).update(otp).digest('hex');
  }

  /** Constant-time compare of a submitted OTP against a stored HMAC hash. */
  verifyOtpHash(otp: string, otpHash: string): boolean {
    const computed = this.hashOtp(otp);
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(otpHash, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
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
