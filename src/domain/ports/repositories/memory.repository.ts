import type { AgentMemory, NewAgentMemory } from "../../entities/index.js";

export interface MemoryRepository {
  findByOrg(orgId: string, limit?: number): Promise<AgentMemory[]>;
  findByOrgAndType(orgId: string, type: string, limit?: number): Promise<AgentMemory[]>;
  search(orgId: string, query: string, limit?: number): Promise<AgentMemory[]>;
  findByKey(orgId: string, type: string, key: string): Promise<AgentMemory | null>;
  create(data: NewAgentMemory): Promise<AgentMemory>;
  upsert(data: NewAgentMemory): Promise<AgentMemory>;
  delete(id: string): Promise<boolean>;
  deleteByOrg(orgId: string): Promise<void>;
  countByOrg(orgId: string): Promise<number>;
}
