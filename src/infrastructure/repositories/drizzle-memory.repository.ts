import { eq, and, ilike, or, count, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentMemories } from "../db/schema.js";
import type { AgentMemoryRow, NewAgentMemoryRow } from "../db/schema.js";
import type { AgentMemoryType } from "../../domain/entities/index.js";
import type { MemoryRepository } from "../../domain/ports/repositories/memory.repository.js";

export class DrizzleMemoryRepository implements MemoryRepository {
  async findByOrg(orgId: string, limit = 50): Promise<AgentMemoryRow[]> {
    return db.query.agentMemories.findMany({
      where: eq(agentMemories.orgId, orgId),
      orderBy: desc(agentMemories.updatedAt),
      limit,
    });
  }

  async findByOrgAndType(orgId: string, type: string, limit = 50): Promise<AgentMemoryRow[]> {
    return db.query.agentMemories.findMany({
      where: and(eq(agentMemories.orgId, orgId), eq(agentMemories.type, type as AgentMemoryType)),
      orderBy: desc(agentMemories.updatedAt),
      limit,
    });
  }

  async search(orgId: string, query: string, limit = 20): Promise<AgentMemoryRow[]> {
    const pattern = `%${query}%`;
    return db.query.agentMemories.findMany({
      where: and(
        eq(agentMemories.orgId, orgId),
        or(
          ilike(agentMemories.key, pattern),
          ilike(agentMemories.content, pattern),
        ),
      ),
      orderBy: desc(agentMemories.updatedAt),
      limit,
    });
  }

  async findByKey(orgId: string, type: string, key: string): Promise<AgentMemoryRow | null> {
    const result = await db.query.agentMemories.findFirst({
      where: and(
        eq(agentMemories.orgId, orgId),
        eq(agentMemories.type, type as AgentMemoryType),
        eq(agentMemories.key, key),
      ),
    });
    return result ?? null;
  }

  async create(data: NewAgentMemoryRow): Promise<AgentMemoryRow> {
    const [row] = await db.insert(agentMemories).values(data).returning();
    return row!;
  }

  async upsert(data: NewAgentMemoryRow): Promise<AgentMemoryRow> {
    const [row] = await db
      .insert(agentMemories)
      .values(data)
      .onConflictDoUpdate({
        target: [agentMemories.orgId, agentMemories.type, agentMemories.key],
        set: {
          content: data.content,
          metadata: data.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(agentMemories).where(eq(agentMemories.id, id)).returning();
    return result.length > 0;
  }

  async deleteByOrg(orgId: string): Promise<void> {
    await db.delete(agentMemories).where(eq(agentMemories.orgId, orgId));
  }

  async countByOrg(orgId: string): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(agentMemories)
      .where(eq(agentMemories.orgId, orgId));
    return result?.value ?? 0;
  }
}
