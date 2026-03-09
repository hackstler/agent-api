export type EntityEventType =
  | "catalog:created"
  | "catalog:updated"
  | "catalog:deleted"
  | "catalog:activated"
  | "catalog:item:created"
  | "catalog:item:updated"
  | "catalog:item:deleted";

export interface EntityEvent {
  type: EntityEventType;
  orgId: string;
  entityId: string;
  /** Related entity ID (e.g. catalogId when the event is about an item) */
  relatedId?: string | undefined;
  timestamp: Date;
}

type EntityListener = (event: EntityEvent) => void;

/**
 * Simple typed pub/sub for entity lifecycle events.
 * Avoids EventEmitter override issues with strict TS.
 */
class EntityEventBus {
  private listeners: EntityListener[] = [];

  on(_event: "entity", listener: EntityListener): void {
    this.listeners.push(listener);
  }

  off(_event: "entity", listener: EntityListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  emit(_event: "entity", payload: EntityEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // fire-and-forget: listener errors must not propagate
      }
    }
  }
}

/** Singleton event bus for entity lifecycle events. */
export const entityEvents = new EntityEventBus();
