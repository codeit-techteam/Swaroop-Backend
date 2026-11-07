import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './decorators/auth.decorators.js';
import { JwtAuthGuard } from './guards/auth.guards.js';
import { maskPhoneForLog } from './services/msg91-otp.errors.js';
import { successResponse } from '../../common/utils/response.util.js';

type Msg91DeliveryReport = {
  requestId?: string;
  request_id?: string;
  mobile?: string;
  status?: string | number;
  failureReason?: string;
  failure_reason?: string;
  senderId?: string;
  DLT_TE_ID?: string;
  flowID?: string;
  deliveryTime?: string;
  [key: string]: unknown;
};

/**
 * MSG91 SendOTP delivery reports ("On Report Received").
 * Configure in MSG91 → OTP → Webhook → URL:
 *   https://swaroop-backend-xzwkz.ondigitalocean.app/api/v1/auth/webhooks/msg91/otp-delivery
 *
 * Never logs OTP values or auth keys. status: 1 = Delivered, 2 = Failed.
 */
@ApiTags('Auth')
@Controller({ path: 'auth/webhooks/msg91', version: '1' })
@UseGuards(JwtAuthGuard)
export class Msg91OtpWebhookController {
  private readonly logger = new Logger(Msg91OtpWebhookController.name);

  @Public()
  @Post('otp-delivery')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'MSG91 OTP delivery report webhook (provider callback)',
  })
  handleDeliveryReport(@Body() body: Msg91DeliveryReport | Msg91DeliveryReport[]) {
    const reports = Array.isArray(body) ? body : [body];
    for (const report of reports) {
      if (!report || typeof report !== 'object') continue;
      const requestId = String(
        report.requestId ?? report.request_id ?? '',
      ).trim();
      const statusRaw = report.status;
      const status =
        statusRaw === 1 || statusRaw === '1'
          ? 'delivered'
          : statusRaw === 2 || statusRaw === '2'
            ? 'failed'
            : String(statusRaw ?? 'unknown');
      const failureReason = String(
        report.failureReason ?? report.failure_reason ?? '',
      ).slice(0, 300);
      const mobile =
        typeof report.mobile === 'string'
          ? maskPhoneForLog(
              report.mobile.startsWith('+')
                ? report.mobile
                : `+${report.mobile}`,
            )
          : undefined;

      this.logger.log({
        event: 'msg91.otp.delivery_report',
        providerRequestId: requestId || 'n/a',
        status,
        failureReason: failureReason || undefined,
        mobile,
        senderId:
          typeof report.senderId === 'string' ? report.senderId : undefined,
        dltTemplateId:
          typeof report.DLT_TE_ID === 'string' ? report.DLT_TE_ID : undefined,
        flowId: typeof report.flowID === 'string' ? report.flowID : undefined,
        deliveryTime:
          typeof report.deliveryTime === 'string'
            ? report.deliveryTime
            : undefined,
      });
    }

    return successResponse({ received: reports.length }, 'OK');
  }
}
