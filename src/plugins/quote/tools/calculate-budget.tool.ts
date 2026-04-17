import { tool } from "ai";
import { z } from "zod";
import crypto from "crypto";
import type { CompanyDetails, QuoteFooterSettings } from "../contracts.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../../domain/ports/repositories/quote.repository.js";
import type { QuoteStrategyRegistry } from "../strategies/index.js";
import { quoteConfig } from "../config/quote.config.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { logger } from "../../../shared/logger.js";

/**
 * Idempotency window: if the same user re-invokes calculateBudget with
 * IDENTICAL inputs within this window, return the cached quote instead of
 * regenerating. This protects against:
 *   - LLM re-invoking the tool for the same request across turns
 *   - User resending the same WhatsApp message
 *   - Webhook deduplication races
 */
const IDEMPOTENCY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function buildInputHash(input: Record<string, unknown>): string {
  const sortedKeys = Object.keys(input).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const value = input[key];
    if (typeof value === "string") {
      normalized[key] = value.trim().toLowerCase();
    } else if (value === null || value === undefined) {
      // skip — undefined fields shouldn't affect the hash
    } else {
      normalized[key] = value;
    }
  }
  const serialized = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export interface CalculateBudgetDeps {
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
    vatRate:  org?.vatRate ? Number(org.vatRate) : 0.21,
    currency: org?.currency ?? quoteConfig.currency,
  };
}

/**
 * Fallback schema used when no per-org schema is available (org without
 * remote business function configured, or pre-warm scenarios). When the
 * delegation layer calls `Plugin.resolveToolsForRequest(orgId)`, the
 * QuotePlugin returns a tool built with the actual schema fetched from
 * the org's business function `/config` endpoint, so the LLM sees the
 * real required fields and extracts them.
 */
const fallbackSchema = z.object({
  clientName:    z.string().describe("Nombre del cliente"),
  clientAddress: z.string().optional().describe("Dirección del cliente"),
}).passthrough();

export interface CreateCalculateBudgetToolOptions {
  /** Per-org input schema from the remote business function. Falls back to clientName/clientAddress passthrough. */
  inputSchema?: z.ZodObject<z.ZodRawShape>;
  /** Per-org tool description from the business function /config. */
  description?: string;
}

export function createCalculateBudgetTool(
  { attachmentStore, organizationRepo, quoteRepo, strategyRegistry }: CalculateBudgetDeps,
  options: CreateCalculateBudgetToolOptions = {},
) {
  // Merge the per-org schema with the always-required client fields, keeping
  // .passthrough() so the LLM can include any extra hint without Zod rejecting it.
  const orgSchema = options.inputSchema;
  const mergedSchema = orgSchema
    ? orgSchema.extend({
        clientName:    z.string().describe("Nombre completo del cliente"),
        clientAddress: z.string().optional().describe("Dirección del cliente"),
      }).passthrough()
    : fallbackSchema;

  return tool({
    description: options.description
      ?? "Calcula y genera un presupuesto en PDF para el cliente. " +
        "Los campos específicos del negocio son resueltos por la lógica " +
        "de negocio de la organización. " +
        "Pasa todos los datos que el cliente te haya proporcionado.",

    inputSchema: mergedSchema,

    execute: async (input, { experimental_context }) => {
      logger.info(
        { inputKeys: Object.keys((input as Record<string, unknown>) ?? {}), inputPreview: JSON.stringify(input).slice(0, 400) },
        "[calculateBudget] execute() ENTRY",
      );

      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) {
        logger.error("[calculateBudget] EARLY EXIT — missing orgId in context");
        return {
          success: false, clientName: "", rows: [], pdfGenerated: false, filename: "",
          error: "Missing orgId in request context",
        };
      }

      const userId = getAgentContextValue({ experimental_context }, "userId");
      const strategyInput = input as Record<string, unknown>;
      const clientName = (strategyInput["clientName"] as string) ?? "";
      const clientAddress = (strategyInput["clientAddress"] as string) ?? "";

      // Build "extra" payload of strategy-specific fields (anything beyond client data)
      // forwarded to the remote business function for PDF rendering.
      const extra: Record<string, unknown> = {};
      for (const key of Object.keys(strategyInput)) {
        if (key !== "clientName" && key !== "clientAddress") {
          extra[key] = strategyInput[key];
        }
      }

      logger.info({ orgId, userId, clientName, clientAddress, extraKeys: Object.keys(extra) }, "[calculateBudget] context resolved");

      // ── Idempotency check: short-circuit if an identical quote was just made.
      const inputHash = buildInputHash(strategyInput);
      if (userId) {
        const recent = await quoteRepo.findRecentByUserAndHash(
          userId,
          inputHash,
          IDEMPOTENCY_WINDOW_MS,
        );
        if (recent) {
          logger.info(
            {
              orgId,
              userId,
              inputHash,
              quoteId: recent.id,
              filename: recent.filename,
              ageMs: Date.now() - recent.createdAt.getTime(),
            },
            "[calculateBudget] IDEMPOTENT HIT — returning cached quote, skipping business function",
          );
          if (recent.pdfBase64) {
            try {
              await attachmentStore.store({
                orgId,
                userId,
                filename: recent.filename,
                attachment: {
                  base64: recent.pdfBase64,
                  mimetype: "application/pdf",
                  filename: recent.filename,
                },
                docType: "quote",
                sourceId: recent.id,
              });
            } catch (err) {
              logger.warn({ err, filename: recent.filename }, "[calculateBudget] re-store of cached PDF failed");
            }
          }
          const cachedRows = Array.isArray((recent.quoteData as { rows?: unknown[] } | null)?.rows)
            ? ((recent.quoteData as { rows: unknown[] }).rows)
            : [];
          return {
            success: true,
            clientName: recent.clientName,
            sectionTitle: undefined,
            notes: undefined,
            rows: cachedRows,
            representativeTotals: {
              subtotal: Number(recent.subtotal),
              vat: Number(recent.vatAmount),
              total: Number(recent.total),
            },
            pdfGenerated: true,
            filename: recent.filename,
            idempotent: true,
          };
        }
      }

      // Fetch org data
      const org = await organizationRepo.findByOrgId(orgId);

      logger.info(
        {
          orgId,
          hasOrg: !!org,
          hasBusinessLogicUrl: !!org?.businessLogicUrl,
        },
        "[calculateBudget] org loaded",
      );

      // Resolve strategy: must be remote
      let activeStrategy;
      try {
        activeStrategy = await strategyRegistry.resolveForOrg(org);
      } catch (err) {
        logger.error({ err, orgId }, "[calculateBudget] strategy resolution failed");
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const company = resolveCompanyDetails(org);
      const footer = resolveQuoteFooter(org);

      logger.info(
        {
          orgId,
          userId,
          strategy: activeStrategy.businessType,
        },
        "[calculateBudget] strategy resolved",
      );

      // Delegate calculation to the strategy
      let result;
      try {
        result = await activeStrategy.calculate({
          input: strategyInput,
          company,
        });
        logger.info(
          {
            orgId,
            rowsCount: result.rows.length,
            firstRow: result.rows[0],
            representativeTotals: result.representativeTotals,
          },
          "[calculateBudget] calculate() returned",
        );
      } catch (err) {
        logger.error({ err, orgId }, "[calculateBudget] calculate() failed");
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
      let pdfBase64: string | undefined;
      try {
        pdfBase64 = await activeStrategy.generatePdf({
          quoteNumber,
          date: dateStr,
          company,
          clientName,
          clientAddress,
          result,
          footer,
          extra,
        });
        logger.info(
          {
            orgId,
            userId,
            quoteNumber,
            filename,
            pdfKB: pdfBase64 ? Math.round(pdfBase64.length / 1024) : 0,
          },
          "[calculateBudget] generatePdf() returned",
        );
      } catch (err) {
        logger.error({ err, orgId, quoteNumber }, "[calculateBudget] generatePdf() failed");
        return {
          success: false, clientName, rows: [], pdfGenerated: false, filename: "",
          error: err instanceof Error ? `PDF error: ${err.message}` : String(err),
        };
      }

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
            lineItems: [],
            subtotal: String(result.representativeTotals.subtotal),
            vatAmount: String(result.representativeTotals.vat),
            total: String(result.representativeTotals.total),
            pdfBase64: pdfBase64 ?? null,
            filename,
            quoteData: result.quoteData as Record<string, unknown>,
            inputHash,
          });
          quoteId = quote.id;
          logger.info({ quoteId, quoteNumber, filename }, "[calculateBudget] quote persisted to DB");
        } catch (err) {
          logger.error({ err, quoteNumber }, "[calculateBudget] Failed to persist quote");
        }
      } else {
        logger.warn({ orgId, userId }, "[calculateBudget] skipping quote persist — missing userId/orgId");
      }

      // Store in AttachmentStore (persistent: memory + DB) — critical for WhatsApp delivery
      let attachmentStored = false;
      if (pdfBase64 && userId) {
        try {
          const pdfAttachment = { base64: pdfBase64, mimetype: "application/pdf", filename };
          await attachmentStore.store({
            orgId,
            userId,
            filename,
            attachment: pdfAttachment,
            docType: "quote",
            ...(quoteId ? { sourceId: quoteId } : {}),
          });
          attachmentStored = true;
          logger.info(
            { orgId, userId, filename, quoteId },
            "[calculateBudget] PDF stored in AttachmentStore (cache + DB)",
          );
        } catch (err) {
          logger.error(
            { err, orgId, userId, filename },
            "[calculateBudget] attachmentStore.store failed — PDF will NOT be deliverable via WhatsApp",
          );
        }
      } else {
        logger.warn(
          { hasPdf: !!pdfBase64, userId },
          "[calculateBudget] skipping attachmentStore — no PDF or no userId",
        );
      }

      const rows = result.rows.map((r) => ({
        itemName: r.itemName,
        ...r.breakdown,
        subtotal: r.subtotal,
        vat: r.vat,
        total: r.total,
      }));

      logger.info(
        {
          orgId,
          userId,
          success: true,
          pdfGenerated: !!pdfBase64,
          attachmentStored,
          filename,
          rowsCount: rows.length,
        },
        "[calculateBudget] tool returning result",
      );

      return {
        success: true,
        clientName,
        sectionTitle: result.sectionTitle,
        notes: result.notes,
        rows,
        representativeTotals: result.representativeTotals,
        pdfGenerated: !!pdfBase64,
        filename,
      };
    },
  });
}
