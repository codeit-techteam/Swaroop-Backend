import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { FinanceEventsService } from './common/finance-events.service.js';
import { PaymentStateService } from './common/payment-state.service.js';
import { ScheduleStateService } from './common/schedule-state.service.js';
import { CustomerFinanceController } from './controllers/customer-finance.controller.js';
import { SellerFinanceController } from './controllers/seller-finance.controller.js';
import { CreditEligibilityService } from './services/credit-eligibility.service.js';
import { CreditLedgerService } from './services/credit-ledger.service.js';
import { CreditTimelineService } from './services/credit-timeline.service.js';
import { ManualCreditInsuranceProvider } from './services/credit-insurance.provider.js';
import { DispatchGateService } from './services/dispatch-gate.service.js';
import { FinanceActorService } from './services/finance-actor.service.js';
import { FinanceBootstrapService } from './services/finance-bootstrap.service.js';
import { FinanceInvoiceService } from './services/finance-invoice.service.js';
import { FinanceSummaryService } from './services/finance-summary.service.js';
import { PaymentScheduleService } from './services/payment-schedule.service.js';
import { PaymentService } from './services/payment.service.js';
import { PaymentVerificationService } from './services/payment-verification.service.js';
import { ProformaInvoiceService } from './services/proforma-invoice.service.js';
import { SettlementCalculationService } from './services/settlement-calculation.service.js';
import { SettlementService } from './services/settlement.service.js';
import { TransactionService } from './services/transaction.service.js';

const financeProviders = [
  FinanceEventsService,
  PaymentStateService,
  ScheduleStateService,
  FinanceActorService,
  CreditEligibilityService,
  CreditLedgerService,
  CreditTimelineService,
  ManualCreditInsuranceProvider,
  PaymentScheduleService,
  ProformaInvoiceService,
  PaymentService,
  PaymentVerificationService,
  TransactionService,
  FinanceInvoiceService,
  SettlementCalculationService,
  SettlementService,
  FinanceBootstrapService,
  FinanceSummaryService,
  DispatchGateService,
];

@Module({
  imports: [AuthModule],
  controllers: [CustomerFinanceController, SellerFinanceController],
  providers: financeProviders,
  exports: [
    FinanceBootstrapService,
    PaymentScheduleService,
    ProformaInvoiceService,
    PaymentService,
    PaymentVerificationService,
    FinanceInvoiceService,
    SettlementService,
    SettlementCalculationService,
    FinanceSummaryService,
    DispatchGateService,
    CreditEligibilityService,
    CreditLedgerService,
    CreditTimelineService,
    TransactionService,
  ],
})
export class PaymentsModule {}
