import { z } from "zod";
import type {
  QuoteStrategy,
  QuoteCalculationResult,
} from "./quote-strategy.interface.js";
import type { CompanyDetails, QuoteFooterSettings } from "../contracts.js";
import { logger } from "../../../shared/logger.js";

// ── Types for the remote business function contract ─────────────────────────

/** Configuration returned by GET /config on the remote business function. */
export interface BusinessFunctionConfig {
  version: string;
  businessType: string;
  displayName: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
      minimum?: number;
      minLength?: number;
    }>;
    required?: string[];
  };
  agentInstructions: Record<string, string>;
  toolDescriptions: {
    calculate: string;
    listCatalog: string;
    listCatalogNote: string;
  };
}

/** Catalog item returned by GET /catalog on the remote business function. */
export interface RemoteCatalogItem {
  code: string;
  name: string;
  description: string;
  category?: string;
  unit?: string;
}

// ── JSON Schema → Zod conversion (lightweight, no external deps) ────────────

function jsonSchemaPropertyToZod(
  _name: string,
  prop: BusinessFunctionConfig["inputSchema"]["properties"][string],
  required: boolean,
): z.ZodTypeAny {
  let schema: z.ZodTypeAny;

  switch (prop.type) {
    case "string":
      if (prop.enum) {
        schema = z.enum(prop.enum as [string, ...string[]]);
      } else {
        let s = z.string();
        if (prop.minLength) s = s.min(prop.minLength);
        schema = s;
      }
      break;
    case "number":
    case "integer": {
      let n = z.number();
      if (prop.minimum !== undefined) n = n.min(prop.minimum);
      schema = n;
      break;
    }
    case "boolean":
      schema = z.boolean();
      break;
    default:
      schema = z.unknown();
  }

  if (prop.description) schema = schema.describe(prop.description);
  if (prop.default !== undefined) schema = schema.default(prop.default);
  if (!required) schema = schema.optional();

  return schema;
}

function jsonSchemaToZod(inputSchema: BusinessFunctionConfig["inputSchema"]): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  const required = new Set(inputSchema.required ?? []);

  for (const [name, prop] of Object.entries(inputSchema.properties)) {
    shape[name] = jsonSchemaPropertyToZod(name, prop, required.has(name));
  }

  return z.object(shape);
}

// ── Remote HTTP client ──────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;

async function remoteFetch(url: string, apiKey: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
    ...(init?.headers as Record<string, string> ?? {}),
  };

  const response = await fetch(url, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Remote business function error: ${response.status} ${response.statusText} — ${body}`);
  }

  return response;
}

// ── RemoteQuoteStrategy ─────────────────────────────────────────────────────

export class RemoteQuoteStrategy implements QuoteStrategy {
  readonly businessType: string;
  readonly displayName: string;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly config: BusinessFunctionConfig;
  private readonly zodSchema: z.ZodObject<z.ZodRawShape>;

  constructor(endpoint: string, apiKey: string, config: BusinessFunctionConfig) {
    this.endpoint = endpoint.replace(/\/+$/, ""); // strip trailing slash
    this.apiKey = apiKey;
    this.config = config;
    this.businessType = config.businessType;
    this.displayName = config.displayName;
    this.zodSchema = jsonSchemaToZod(config.inputSchema);
  }

  /** Fetch and validate the remote config. Factory method — call this, not the constructor directly. */
  static async create(endpoint: string, apiKey: string): Promise<RemoteQuoteStrategy> {
    const url = `${endpoint.replace(/\/+$/, "")}/config`;
    logger.info({ url }, "Fetching remote business function config");

    const res = await remoteFetch(url, apiKey);
    const config = await res.json() as BusinessFunctionConfig;

    if (!config.businessType || !config.inputSchema?.properties) {
      throw new Error(`Invalid config from ${url}: missing businessType or inputSchema`);
    }

    return new RemoteQuoteStrategy(endpoint, apiKey, config);
  }

  // ── QuoteStrategy interface ─────────────────────────────────────────────

  getInputSchema(): z.ZodObject<z.ZodRawShape> {
    return this.zodSchema;
  }

  getToolDescription(): string {
    return this.config.toolDescriptions.calculate;
  }

  getAgentInstructions(lang: string): string {
    return this.config.agentInstructions[lang]
      ?? this.config.agentInstructions["es"]
      ?? this.config.agentInstructions[Object.keys(this.config.agentInstructions)[0]!]
      ?? "";
  }

  getListCatalogDescription(): string {
    return this.config.toolDescriptions.listCatalog;
  }

  getListCatalogNote(): string {
    return this.config.toolDescriptions.listCatalogNote;
  }

  // ── Remote delegation ─────────────────────────────────────────────────────

  async calculate(params: {
    input: Record<string, unknown>;
    company: CompanyDetails;
  }): Promise<QuoteCalculationResult> {
    const url = `${this.endpoint}/calculate`;

    logger.info({ url, businessType: this.businessType }, "Calling remote calculate");

    const res = await remoteFetch(url, this.apiKey, {
      method: "POST",
      body: JSON.stringify({
        input: params.input,
        company: params.company,
      }),
    });

    const result = await res.json() as QuoteCalculationResult;

    // Basic validation — the remote must return the expected shape
    if (!Array.isArray(result.rows)) {
      throw new Error("Remote calculate response missing 'rows' array");
    }
    if (!result.representativeTotals) {
      throw new Error("Remote calculate response missing 'representativeTotals'");
    }

    return result;
  }

  async generatePdf(params: {
    quoteNumber: string;
    date: string;
    company: CompanyDetails;
    clientName: string;
    clientAddress: string;
    result: QuoteCalculationResult;
    footer?: QuoteFooterSettings | undefined;
    extra?: Record<string, unknown> | undefined;
  }): Promise<string> {
    const url = `${this.endpoint}/pdf`;

    logger.info({ url, quoteNumber: params.quoteNumber }, "Calling remote PDF generation");

    const res = await remoteFetch(url, this.apiKey, {
      method: "POST",
      body: JSON.stringify({
        quoteNumber: params.quoteNumber,
        date: params.date,
        company: params.company,
        clientName: params.clientName,
        clientAddress: params.clientAddress,
        result: params.result,
        footer: params.footer,
        ...(params.extra ?? {}),
      }),
    });

    const data = await res.json() as { pdf: string };

    if (!data.pdf || typeof data.pdf !== "string") {
      throw new Error("Remote PDF response missing 'pdf' base64 string");
    }

    return data.pdf;
  }

  // ── Remote catalog ────────────────────────────────────────────────────────

  async fetchCatalog(): Promise<RemoteCatalogItem[]> {
    const url = `${this.endpoint}/catalog`;

    logger.info({ url, businessType: this.businessType }, "Fetching remote catalog");

    const res = await remoteFetch(url, this.apiKey);
    const data = await res.json() as { items: RemoteCatalogItem[] };

    return data.items ?? [];
  }
}
