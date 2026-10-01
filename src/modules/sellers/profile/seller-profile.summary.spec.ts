import {
  buildSellerProfileSummary,
  initialsFor,
  maskAccountNumber,
  type SellerProfileSummarySource,
} from './seller-profile.summary.js';

const baseProfile = (): SellerProfileSummarySource => ({
  id: 'sp-1',
  status: 'APPROVED',
  sellerType: null,
  approvedAt: null,
  organization: {
    name: 'Altix Codeit Pvt. Ltd.',
    legalName: 'Altix Codeit Pvt. Ltd.',
    businessType: null,
    industry: null,
    gstin: '19ABCCA6289R1ZP',
    pan: 'FCOPR2498H',
    email: null,
    phone: null,
    logoUrl: null,
    verificationStatus: 'APPROVED',
  },
  verification: {
    gstVerified: true,
    panVerified: true,
    bankVerified: false,
    overallStatus: 'APPROVED',
  },
  onboarding: {
    status: 'APPROVED',
    companyData: { contactName: 'SUMIT KUMAR ROUTH', designation: 'Director' },
    businessData: { paymentTerms: 'Advance' },
    gstData: { state: 'West Bengal' },
    panData: {},
    bankData: {},
    addressData: {
      line1: 'Salt Lake',
      city: 'Kolkata',
      state: 'West Bengal',
      postalCode: '700091',
    },
  },
  user: {
    email: null,
    phone: '+918240890242',
    firstName: 'Karan',
    lastName: 'Veer',
    displayName: null,
  },
});

describe('buildSellerProfileSummary', () => {
  it('uses DB organization identity and the logged-in user name', () => {
    const summary = buildSellerProfileSummary(baseProfile());
    expect(summary.companyName).toBe('Altix Codeit Pvt. Ltd.');
    expect(summary.ownerName).toBe('Karan Veer');
    expect(summary.initials).toBe('KV');
    expect(summary.contactName).toBe('SUMIT KUMAR ROUTH');
    expect(summary.gstin).toBe('19ABCCA6289R1ZP');
    expect(summary.pan).toBe('FCOPR2498H');
    expect(summary.verified).toBe(true);
    expect(summary.address?.city).toBe('Kolkata');
    expect(summary.paymentTerms).toBe('Advance');
  });

  it('falls back to onboarding data while the organization is still a placeholder', () => {
    const profile = baseProfile();
    profile.organization.name = 'Seller Organization';
    profile.organization.legalName = null;
    profile.organization.gstin = null;
    profile.onboarding!.companyData = {
      name: 'Draft Co',
      legalName: 'Draft Co Pvt Ltd',
    };
    profile.onboarding!.gstData = { gstin: '27AAAAA0000A1Z5' };
    const summary = buildSellerProfileSummary(profile);
    expect(summary.companyName).toBe('Draft Co');
    expect(summary.legalName).toBe('Draft Co Pvt Ltd');
    expect(summary.gstin).toBe('27AAAAA0000A1Z5');
  });

  it('never returns the raw bank account number', () => {
    const summary = buildSellerProfileSummary(baseProfile(), {
      bank: {
        accountHolder: 'Altix',
        bankName: 'HDFC',
        accountNumber: '50100123456789',
        ifsc: 'HDFC0000001',
        branch: null,
        verificationStatus: 'APPROVED',
      },
    });
    expect(summary.bank?.accountNumberMasked.endsWith('6789')).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('50100123456789');
    expect(summary.bankVerified).toBe(true);
  });

  it('helpers', () => {
    expect(maskAccountNumber('1234')).toBe('1234');
    expect(initialsFor('')).toBe('PT');
    expect(initialsFor('altix codeit')).toBe('AC');
  });
});
