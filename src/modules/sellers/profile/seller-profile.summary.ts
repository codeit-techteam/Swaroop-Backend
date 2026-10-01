type JsonRecord = Record<string, unknown>;

export type SellerProfileSummarySource = {
  id: string;
  status: string;
  sellerType: string | null;
  approvedAt: Date | null;
  organization: {
    name: string;
    legalName: string | null;
    businessType: string | null;
    industry: string | null;
    gstin: string | null;
    pan: string | null;
    email: string | null;
    phone: string | null;
    logoUrl: string | null;
    verificationStatus: string;
  };
  verification: {
    gstVerified: boolean;
    panVerified: boolean;
    bankVerified: boolean;
    overallStatus: string;
  } | null;
  onboarding: {
    status: string;
    companyData: unknown;
    businessData: unknown;
    gstData: unknown;
    panData: unknown;
    bankData: unknown;
    addressData: unknown;
  } | null;
  user: {
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  };
};

export type SellerProfileSummaryAddress = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  type: string;
};

export type SellerProfileSummaryBank = {
  accountHolder: string;
  bankName: string;
  accountNumberMasked: string;
  ifsc: string;
  branch: string | null;
  verificationStatus: string;
};

/** Platform-neutral seller identity shared by Seller Web and the Seller app. */
export type SellerProfileSummary = {
  sellerProfileId: string;
  status: string;
  verificationStatus: string;
  verified: boolean;
  ownerName: string;
  companyName: string;
  legalName: string;
  initials: string;
  businessType: string | null;
  sellerType: string | null;
  industry: string | null;
  contactName: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  gstState: string | null;
  pan: string | null;
  logoUrl: string | null;
  yearsInBusiness: string | null;
  paymentTerms: string | null;
  registeredAddress: string | null;
  address: SellerProfileSummaryAddress | null;
  bank: SellerProfileSummaryBank | null;
  gstVerified: boolean;
  panVerified: boolean;
  bankVerified: boolean;
  kycDocumentsCount: number;
  approvedAt: Date | null;
};

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const text = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return null;
};

export const maskAccountNumber = (value: string): string => {
  const digits = value.replace(/\s/g, '');
  if (digits.length <= 4) return digits;
  return `${'•'.repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`;
};

export const initialsFor = (value: string): string =>
  value
    .split(/\s+/)
    .filter((part) => /[A-Za-z0-9]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || 'PT';

export function buildSellerProfileSummary(
  profile: SellerProfileSummarySource,
  extras: {
    address?: SellerProfileSummaryAddress | null;
    bank?: {
      accountHolder: string;
      bankName: string;
      accountNumber: string;
      ifsc: string;
      branch: string | null;
      verificationStatus: string;
    } | null;
    kycDocumentsCount?: number;
  } = {},
): SellerProfileSummary {
  const org = profile.organization;
  const company = asRecord(profile.onboarding?.companyData);
  const business = asRecord(profile.onboarding?.businessData);
  const gst = asRecord(profile.onboarding?.gstData);
  const pan = asRecord(profile.onboarding?.panData);
  const bankData = asRecord(profile.onboarding?.bankData);
  const addressData = asRecord(profile.onboarding?.addressData);

  const userName =
    text(
      profile.user.displayName,
      [profile.user.firstName, profile.user.lastName].filter(Boolean).join(' '),
    ) ?? null;
  const companyName =
    text(
      org.name !== 'Seller Organization' ? org.name : null,
      company.name,
      company.legalName,
      org.legalName,
    ) ?? 'Seller Organization';
  const legalName =
    text(org.legalName, company.legalName, companyName) ?? companyName;
  const contactName = text(company.contactName, userName) ?? companyName;
  const ownerName = userName ?? contactName;

  const address =
    extras.address ??
    (text(addressData.line1)
      ? {
          line1: text(addressData.line1)!,
          city: text(addressData.city) ?? '',
          state: text(addressData.state) ?? '',
          postalCode: text(addressData.postalCode, addressData.pincode) ?? '',
          type: 'REGISTERED',
        }
      : null);

  const bankSource =
    extras.bank ??
    (text(bankData.accountNumber)
      ? {
          accountHolder: text(bankData.accountHolder) ?? legalName,
          bankName: text(bankData.bankName) ?? '',
          accountNumber: text(bankData.accountNumber)!,
          ifsc: text(bankData.ifsc) ?? '',
          branch: text(bankData.branch),
          verificationStatus: 'PENDING',
        }
      : null);

  const verification = profile.verification;
  const verificationStatus =
    verification?.overallStatus ?? org.verificationStatus;

  return {
    sellerProfileId: profile.id,
    status: profile.status,
    verificationStatus,
    verified:
      profile.status === 'APPROVED' || verificationStatus === 'APPROVED',
    ownerName,
    companyName,
    legalName,
    initials: initialsFor(ownerName),
    businessType: text(org.businessType, company.businessType),
    sellerType: text(profile.sellerType, business.sellerType),
    industry: text(org.industry, company.industry),
    contactName,
    designation: text(company.designation),
    email: text(company.email, org.email, profile.user.email),
    phone: text(company.phone, org.phone, profile.user.phone),
    gstin: text(org.gstin, gst.gstin),
    gstState: text(gst.state),
    pan: text(org.pan, pan.pan, gst.pan),
    logoUrl: org.logoUrl,
    yearsInBusiness: text(company.yearsInBusiness),
    paymentTerms: text(business.paymentTerms),
    registeredAddress: text(company.registeredAddress, address?.line1),
    address,
    bank: bankSource
      ? {
          accountHolder: bankSource.accountHolder,
          bankName: bankSource.bankName,
          accountNumberMasked: maskAccountNumber(bankSource.accountNumber),
          ifsc: bankSource.ifsc,
          branch: bankSource.branch,
          verificationStatus: bankSource.verificationStatus,
        }
      : null,
    gstVerified: Boolean(verification?.gstVerified),
    panVerified: Boolean(verification?.panVerified),
    bankVerified:
      Boolean(verification?.bankVerified) ||
      bankSource?.verificationStatus === 'APPROVED',
    kycDocumentsCount: extras.kycDocumentsCount ?? 0,
    approvedAt: profile.approvedAt,
  };
}
