/**
 * Default values used as fallback when an organization has no data configured.
 * In production, the org record in the database takes precedence.
 *
 * Domain-specific defaults (line-item prices, business thresholds, VAT) live
 * in the remote business function, not here. The agent-api is agnostic to those.
 */
export const quoteConfig = {
  companyName:    process.env["QUOTE_COMPANY_NAME"]    ?? "Tu Empresa S.L.",
  companyAddress: process.env["QUOTE_COMPANY_ADDRESS"] ?? "Calle Ejemplo, 1 · 28001 Madrid",
  companyPhone:   process.env["QUOTE_COMPANY_PHONE"]   ?? "+34 600 000 000",
  companyNif:     process.env["QUOTE_COMPANY_NIF"]     ?? "B-00000000",
  companyEmail:   process.env["QUOTE_COMPANY_EMAIL"]   ?? "info@tuempresa.com",

  currency: "€",

  quoteValidityDays: 60,
  paymentTerms: "La forma de pago será 50% a la aprobación del presupuesto y 50% a la finalización de la obra.",
  companyRegistration: "",

  agentName: "QuoteAgent",
} as const;
