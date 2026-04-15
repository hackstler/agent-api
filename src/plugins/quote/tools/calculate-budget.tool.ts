import { tool } from "ai";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, CompanyDetails } from "../services/pdf.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../../domain/ports/repositories/quote.repository.js";
import type { QuoteStrategyRegistry } from "../strategies/index.js";
import type { QuoteFooterSettings } from "../services/pdf.service.js";
import { quoteConfig } from "../config/quote.config.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { logger } from "../../../shared/logger.js";

export interface CalculateBudgetDeps {
  catalogService: CatalogService;
  pdfService: PdfService;
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
  quoteRepo: QuoteRepository;
  strategyRegistry: QuoteStrategyRegistry;
}

/** Build QuoteFooterSettings from org.quoteSettings, falling back to quoteConfig defaults. */
function resolveQuoteFooter(
  org: { quoteSettings?: import("../../../domain/entities/index.js").QuoteSettings | null } | null,
): QuoteFooterSettings {
  const qs = org?.quoteSettings;
  return {
    paymentTerms: qs?.paymentTerms ?? quoteConfig.paymentTerms,
    quoteValidityDays: qs?.quoteValidityDays ?? quoteConfig.quoteValidityDays,
    companyRegistration: qs?.companyRegistration ?? quoteConfig.companyRegistration,
  };
}

/** Build CompanyDetails from org record, falling back to quoteConfig defaults. */
function resolveCompanyDetails(
  org: { name: string | null; address: string | null; phone: string | null; email: string | null; nif: string | null; logo: string | null; web: string | null; vatRate: string | null; currency: string } | null,
): CompanyDetails {
  return {
    name:     org?.name    ?? quoteConfig.companyName,
    address:  org?.address ?? quoteConfig.companyAddress,
    phone:    org?.phone   ?? quoteConfig.companyPhone,
    email:    org?.email   ?? quoteConfig.companyEmail,
    nif:      org?.nif     ?? quoteConfig.companyNif,
    logo:     org?.logo    ?? null,
    web:      org?.web     ?? "",
    vatRate:  org?.vatRate  ? Number(org.vatRate) : quoteConfig.vatRate,
    currency: org?.currency ?? quoteConfig.currency,
  };
}

export function createCalculateBudgetTool({ catalogService, pdfService, attachmentStore, organizationRepo, quoteRepo, strategyRegistry }: CalculateBudgetDeps) {
  // Default strategy provides the initial schema/description at tool creation time.
  // At runtime, the actual strategy is resolved per-org (local or remote).
  const defaultStrategy = strategyRegistry.getDefault();

  return tool({
    description: defaultStrategy.getToolDescription(),

    inputSchema: defaultStrategy.getInputSchema(),

    execute: async (input, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) {
        return {
          success: false, clientName: "", rows: [], pdfGenerated: false, filename: "",
          error: "Missing orgId in request context",
        };
      }

      const userId = getAgentContextValue({ experimental_context }, "userId");
      const strategyInput = input as Record<string, unknown>;
      const clientName = (strategyInput["clientName"] as string) ?? "";
      const clientAddress = (strategyInput["clientAddress"] as string) ?? "";
      const province = (strategyInput["province"] as string) ?? "";

      // Fetch org data and catalog in parallel
      const [org, activeCatalog] = await Promise.all([
        organizationRepo.findByOrgId(orgId),
        catalogService.getActiveCatalog(orgId),
      ]);

      if (!activeCatalog) {
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: "No active catalog found for this organization",
        };
      }

      // Resolve strategy: remote (if org has businessLogicUrl) or local (by catalog businessType)
      const activeStrategy = await strategyRegistry.resolveForOrg(org, activeCatalog.businessType);
      const company = resolveCompanyDetails(org);
      const footer = resolveQuoteFooter(org);

      // Delegate calculation to the strategy — it knows its own input fields
      let result;
      try {
        result = await activeStrategy.calculate({
          input: strategyInput,
          company,
          catalogId: activeCatalog.id,
          catalogService,
          catalogSettings: activeCatalog.settings,
        });
      } catch (err) {
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Generate quote number and filename
      const now = new Date();
      const quoteNumber = `PRES-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
      const filename = `${quoteNumber}.pdf`;

      // Delegate PDF generation to the strategy
      const pdfBase64 = await activeStrategy.generatePdf({
        quoteNumber,
        date: dateStr,
        company,
        clientName,
        clientAddress,
        province,
        result,
        pdfService,
        footer,
      });

      // Persist quote to DB FIRST (we need quote.id as sourceId for the attachment)
      let quoteId: string | undefined;
      if (userId && orgId) {
        try {
          const quote = await quoteRepo.create({
            orgId,
            userId,
            quoteNumber,
            clientName,
            clientAddress,
            lineItems: [], // comparison quotes don't use line items
            subtotal: String(result.representativeTotals.subtotal),
            vatAmount: String(result.representativeTotals.vat),
            total: String(result.representativeTotals.total),
            pdfBase64: pdfBase64 ?? null,
            filename,
            quoteData: result.quoteData as Record<string, unknown>,
            ...result.extraColumns,
          });
          quoteId = quote.id;
        } catch (err) {
          logger.error({ err }, "Failed to persist quote");
        }
      }

      // Store in AttachmentStore (persistent: memory + DB)
      if (pdfBase64 && userId) {
        const pdfAttachment = { base64: pdfBase64, mimetype: "application/pdf", filename };
        await attachmentStore.store({
          orgId,
          userId,
          filename,
          attachment: pdfAttachment,
          docType: "quote",
          ...(quoteId ? { sourceId: quoteId } : {}),
        });
      }

      // Build generic response — strategy-specific fields live in rows
      return {
        success: true,
        clientName,
        rows: result.rows.map((r) => ({
          itemName: r.itemName,
          breakdown: r.breakdown,
          total: r.total,
        })),
        pdfGenerated: !!pdfBase64,
        filename,
      };
    },
  });
}
