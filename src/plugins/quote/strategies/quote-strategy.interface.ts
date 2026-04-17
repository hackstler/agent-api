import type { z } from "zod";
import type { CompanyDetails, QuoteFooterSettings } from "../contracts.js";

// ── Generic result types returned by every strategy ─────────────────────────

/** A single row in the comparison table — strategy defines what fields go inside `breakdown`. */
export interface QuoteComparisonRow {
  itemName: string;
  /** Key-value pairs for each cost component, defined by the strategy. */
  breakdown: Record<string, number>;
  subtotal: number;
  vat: number;
  total: number;
}

export interface QuoteCalculationResult {
  rows: QuoteComparisonRow[];
  /** Free-form notes shown below the table */
  notes: string[];
  /** Section title above the table */
  sectionTitle: string;
  /** Strategy-specific data persisted as JSONB in the quotes table */
  quoteData: Record<string, unknown>;
  /** Representative totals for the quote record */
  representativeTotals: { subtotal: number; vat: number; total: number };
}

// ── PDF column definition for data-driven rendering ─────────────────────────

export interface PdfColumnDef {
  header: string;
  subheader?: string;
  /** Key in QuoteComparisonRow.breakdown, or "itemName"/"subtotal"/"vat"/"total" */
  field: string;
  width: number;
  bold?: boolean;
}

// ── The strategy contract ───────────────────────────────────────────────────

export interface QuoteStrategy {
  /** Unique identifier for this business type, supplied by the remote business function. */
  readonly businessType: string;

  /** Human-readable display name, supplied by the remote business function. */
  readonly displayName: string;

  /** Zod schema for the tool's inputSchema — strategy-specific fields */
  getInputSchema(): z.ZodObject<z.ZodRawShape>;

  /** Description shown to the LLM for the calculateBudget tool */
  getToolDescription(): string;

  /** System prompt for the QuoteAgent when this strategy is active */
  getAgentInstructions(lang: string): string;

  /** Description for the listCatalog tool */
  getListCatalogDescription(): string;

  /** Note returned by listCatalog to guide the LLM */
  getListCatalogNote(): string;

  /**
   * Core calculation: given validated input + company, produce comparison rows.
   * The tool handles context extraction, company resolution, and persistence.
   */
  calculate(params: {
    input: Record<string, unknown>;
    company: CompanyDetails;
  }): Promise<QuoteCalculationResult>;

  /** Generate the PDF for this quote — returns base64 string. */
  generatePdf(params: {
    quoteNumber: string;
    date: string;
    company: CompanyDetails;
    clientName: string;
    clientAddress: string;
    result: QuoteCalculationResult;
    footer?: QuoteFooterSettings | undefined;
    /** Strategy-specific extra fields (e.g. province) — passed through to the remote business function. */
    extra?: Record<string, unknown> | undefined;
  }): Promise<string>;
}
