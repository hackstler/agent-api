import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { DocumentRepository } from "../../domain/ports/repositories/document.repository.js";
import type { TopicRepository } from "../../domain/ports/repositories/topic.repository.js";
import type { WhatsAppSessionRepository } from "../../domain/ports/repositories/whatsapp-session.repository.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { CatalogRepository } from "../../domain/ports/repositories/catalog.repository.js";
import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import type { Organization } from "../../domain/entities/index.js";
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from "../../domain/errors/index.js";

export interface OrgSummary {
  orgId: string;
  name: string | null;
  userCount: number;
  docCount: number;
  createdAt: string | null;
}

export interface CreateOrgDto {
  orgId: string;
  adminEmail: string;
  adminPassword?: string | undefined;
  slug?: string | null | undefined;
  name?: string | null | undefined;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  nif?: string | null | undefined;
  logo?: string | null | undefined;
  vatRate?: string | null | undefined;
  currency?: string | undefined;
  features?: import("../../domain/entities/index.js").OrgFeatures | null | undefined;
}

export interface UpdateOrgDto {
  slug?: string | null | undefined;
  name?: string | null | undefined;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  nif?: string | null | undefined;
  logo?: string | null | undefined;
  vatRate?: string | null | undefined;
  currency?: string | undefined;
  features?: import("../../domain/entities/index.js").OrgFeatures | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

export class OrganizationManager {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly docRepo: DocumentRepository,
    private readonly topicRepo: TopicRepository,
    private readonly sessionRepo: WhatsAppSessionRepository,
    private readonly orgRepo: OrganizationRepository,
    private readonly catalogRepo: CatalogRepository,
    private readonly strategy: AuthStrategy,
  ) {}

  async list(): Promise<OrgSummary[]> {
    const [allOrgs, userCounts, docCounts] = await Promise.all([
      this.orgRepo.findAll(),
      this.userRepo.countByOrg(),
      this.docRepo.countByOrg(),
    ]);

    const userCountMap = new Map(userCounts.map((u) => [u.orgId, u]));
    const docCountMap = new Map(docCounts.map((d) => [d.orgId, d.docCount]));

    // Use organizations table as source of truth, enriched with counts
    const orgSet = new Set(allOrgs.map((o) => o.orgId));
    const result: OrgSummary[] = allOrgs.map((org) => ({
      orgId: org.orgId,
      name: org.name ?? null,
      userCount: userCountMap.get(org.orgId)?.userCount ?? 0,
      docCount: docCountMap.get(org.orgId) ?? 0,
      createdAt: org.createdAt?.toISOString() ?? null,
    }));

    // Also include orgs that have users but no organizations row (legacy)
    for (const row of userCounts) {
      if (!orgSet.has(row.orgId)) {
        result.push({
          orgId: row.orgId,
          name: null,
          userCount: row.userCount,
          docCount: docCountMap.get(row.orgId) ?? 0,
          createdAt: row.earliestCreatedAt ? row.earliestCreatedAt.toISOString() : null,
        });
      }
    }

    return result;
  }

  async getByOrgId(orgId: string): Promise<Organization> {
    const org = await this.orgRepo.findByOrgId(orgId);
    if (!org) throw new NotFoundError("Organization", orgId);
    return org;
  }

  async update(orgId: string, _callerOrgId: string, data: UpdateOrgDto): Promise<Organization> {
    return this.orgRepo.update(orgId, data);
  }

  async create(dto: CreateOrgDto): Promise<{ orgId: string; admin: Record<string, unknown> }> {
    // Check both users and organizations tables for existing orgId
    const [existingOrgRow, existingOrgUser] = await Promise.all([
      this.orgRepo.findByOrgId(dto.orgId),
      this.userRepo.findFirstByOrg(dto.orgId),
    ]);
    if (existingOrgRow || existingOrgUser) throw new ConflictError("Organization", `orgId '${dto.orgId}'`);

    const existingUser = await this.userRepo.findByEmail(dto.adminEmail);
    if (existingUser) throw new ConflictError("User", `email '${dto.adminEmail}'`);

    // Create the organizations row
    await this.orgRepo.create({
      orgId: dto.orgId,
      slug: dto.slug,
      name: dto.name,
      address: dto.address,
      phone: dto.phone,
      email: dto.email,
      nif: dto.nif,
      logo: dto.logo,
      vatRate: dto.vatRate,
      currency: dto.currency,
      features: dto.features,
    });

    // Build admin metadata — include password hash only if provided and strategy supports it
    const metadata: Record<string, unknown> = {};
    if (dto.adminPassword && this.strategy.hashPassword) {
      metadata["passwordHash"] = this.strategy.hashPassword(dto.adminPassword);
    }
    if (!dto.adminPassword) {
      metadata["authStrategy"] = "firebase";
    }

    const admin = await this.userRepo.create({
      email: dto.adminEmail,
      orgId: dto.orgId,
      role: "admin",
      metadata,
    });

    return {
      orgId: dto.orgId,
      admin: {
        id: admin.id,
        email: admin.email,
        orgId: admin.orgId,
        role: "admin",
        createdAt: admin.createdAt.toISOString(),
      },
    };
  }

  async delete(orgId: string, callerOrgId: string): Promise<void> {
    if (callerOrgId === orgId) {
      throw new ValidationError("Cannot delete your own organization");
    }

    const orgExists = await this.userRepo.findFirstByOrg(orgId);
    if (!orgExists) throw new NotFoundError("Organization", orgId);

    // Cascade delete in order (documents cascade chunks via FK)
    await this.catalogRepo.deleteByOrg(orgId);
    await this.docRepo.deleteByOrg(orgId);
    await this.topicRepo.deleteByOrg(orgId);
    await this.sessionRepo.deleteByOrgId(orgId);
    await this.userRepo.deleteByOrg(orgId);
    await this.orgRepo.deleteByOrgId(orgId);
  }
}
