/**
 * Shared contracts for the quote plugin — types used by strategies, tools,
 * and routes. No business logic; just data shapes.
 *
 * After the decoupling: the quote plugin is agnostic to any specific business
 * domain. All calculation/PDF logic lives in remote business functions per org.
 */

/** Company details sent to the remote business function for quote generation. */
export interface CompanyDetails {
  name: string;
  address: string;
  phone: string;
  email: string;
  nif: string;
  logo: string | null;
  vatRate: number;
  currency: string;
  web: string;
}

/** Per-org footer settings sent to the remote business function. */
export interface QuoteFooterSettings {
  paymentTerms: string;
  quoteValidityDays: number;
  companyRegistration: string;
}
