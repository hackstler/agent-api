import type { AgentMemory, NewAgentMemory, AgentMemoryType } from "../../domain/entities/index.js";
import type { MemoryRepository } from "../../domain/ports/repositories/memory.repository.js";
import { logger } from "../../shared/logger.js";

const MAX_MEMORIES_PER_ORG = 200;

export class MemoryManager {
  constructor(private readonly repo: MemoryRepository) {}

  /** List all memories for an org, most recently updated first. */
  async listForOrg(orgId: string, limit = 50): Promise<AgentMemory[]> {
    return this.repo.findByOrg(orgId, limit);
  }

  /** List memories filtered by type. */
  async listByType(orgId: string, type: AgentMemoryType, limit = 50): Promise<AgentMemory[]> {
    return this.repo.findByOrgAndType(orgId, type, limit);
  }

  /** Search memories by keyword (ILIKE on key + content). */
  async search(orgId: string, query: string, limit = 20): Promise<AgentMemory[]> {
    return this.repo.search(orgId, query, limit);
  }

  /**
   * Save or update a memory. Uses upsert on (orgId, type, key).
   * Enforces a per-org limit to prevent unbounded growth.
   */
  async save(data: NewAgentMemory): Promise<AgentMemory> {
    const currentCount = await this.repo.countByOrg(data.orgId);
    const existing = await this.repo.findByKey(data.orgId, data.type, data.key);

    if (!existing && currentCount >= MAX_MEMORIES_PER_ORG) {
      logger.warn({ orgId: data.orgId, count: currentCount, limit: MAX_MEMORIES_PER_ORG }, "Memory limit reached");
      throw new Error(`Límite de memorias alcanzado (${MAX_MEMORIES_PER_ORG}). Elimina memorias antiguas antes de guardar nuevas.`);
    }

    return this.repo.upsert(data);
  }

  /** Delete a specific memory by ID. */
  async delete(id: string): Promise<boolean> {
    return this.repo.delete(id);
  }

  /** Delete all memories for an org. */
  async deleteByOrg(orgId: string): Promise<void> {
    return this.repo.deleteByOrg(orgId);
  }
}
