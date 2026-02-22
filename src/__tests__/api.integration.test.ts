/**
 * Integration tests for the RAG agent API.
 *
 * These tests require:
 *   - Server running on http://localhost:3000
 *   - PostgreSQL accessible (DATABASE_URL)
 *   - GOOGLE_API_KEY set for embedding/chat tests
 *
 * Run: npm test
 * Against a live server: BASE_URL=http://your-host:3000 npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// NOTE: Vite/vitest reserves BASE_URL (sets it to "/"), so we use TEST_API_URL instead
const BASE_URL = process.env["TEST_API_URL"] || "http://localhost:3000";

// ============================================================
// Helpers
// ============================================================

async function get(path: string) {
  return fetch(`${BASE_URL}${path}`);
}

async function post(path: string, body: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function del(path: string) {
  return fetch(`${BASE_URL}${path}`, { method: "DELETE" });
}

let serverAvailable = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      serverAvailable = true;
      console.log("[test setup] server=ok");
    }
  } catch {
    console.log("[test setup] server not reachable — tests will be skipped");
  }
});

afterAll(() => {
  if (!serverAvailable) {
    console.warn("⚠️  All tests skipped — server not running at", BASE_URL);
  }
});

// ============================================================
// Health
// ============================================================

describe("GET /health", () => {
  it("returns 200 with database status", async () => {
    if (!serverAvailable) return;

    const res = await get("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      services: { database: string };
      version: string;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(body.services.database).toBe("ok");
    expect(body.version).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });
});

// ============================================================
// Conversations CRUD
// ============================================================

describe("Conversations API", () => {
  let createdId: string;

  it("POST /conversations — creates a new conversation", async () => {
    if (!serverAvailable) return;

    const res = await post("/conversations", { title: "Test conversation" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string; title: string; createdAt: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.title).toBe("Test conversation");
    expect(body.createdAt).toBeDefined();

    createdId = body.id;
  });

  it("GET /conversations — lists conversations", async () => {
    if (!serverAvailable) return;

    const res = await get("/conversations");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /conversations/:id — returns conversation with messages", async () => {
    if (!serverAvailable || !createdId) return;

    const res = await get(`/conversations/${createdId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; messages: unknown[] };
    expect(body.id).toBe(createdId);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("GET /conversations/:id — returns 404 for unknown id", async () => {
    if (!serverAvailable) return;

    const res = await get("/conversations/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("DELETE /conversations/:id — deletes the conversation", async () => {
    if (!serverAvailable || !createdId) return;

    const res = await del(`/conversations/${createdId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { deleted: boolean; id: string };
    expect(body.deleted).toBe(true);
    expect(body.id).toBe(createdId);

    const check = await get(`/conversations/${createdId}`);
    expect(check.status).toBe(404);
  });
});

// ============================================================
// Ingest
// ============================================================

describe("Ingest API", () => {
  let documentId: string;

  it("POST /ingest — ingests a text file and creates embeddings", async () => {
    if (!serverAvailable) return;

    const content = "RAG systems combine retrieval and generation for accurate answers.";
    const file = new File([content], "test.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${BASE_URL}/ingest`, { method: "POST", body: form });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      documentId: string;
      status: string;
      chunkCount: number;
    };
    expect(body.documentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe("indexed");
    expect(body.chunkCount).toBeGreaterThan(0);

    documentId = body.documentId;
  });

  it("GET /ingest/status/:id — returns document status", async () => {
    if (!serverAvailable || !documentId) return;

    const res = await get(`/ingest/status/${documentId}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; status: string; chunkCount: number };
    expect(body.id).toBe(documentId);
    expect(body.status).toBe("indexed");
    expect(body.chunkCount).toBeGreaterThan(0);
  });

  it("GET /ingest/status/:id — returns 404 for unknown id", async () => {
    if (!serverAvailable) return;

    const res = await get("/ingest/status/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("POST /ingest — returns 400 for missing file", async () => {
    if (!serverAvailable) return;

    const form = new FormData();
    const res = await fetch(`${BASE_URL}/ingest`, { method: "POST", body: form });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Chat
// ============================================================

describe("Chat API", () => {
  it("POST /chat — returns 400 for empty query", async () => {
    if (!serverAvailable) return;

    const res = await post("/chat", { query: "" });
    expect(res.status).toBe(400);
  });

  it("POST /chat — returns 400 for missing query", async () => {
    if (!serverAvailable) return;

    const res = await post("/chat", {});
    expect(res.status).toBe(400);
  });

  it("POST /chat — returns answer with sources and metadata", async () => {
    if (!serverAvailable) return;

    const res = await post("/chat", { query: "What is RAG?" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      conversationId: string;
      answer: string;
      sources: unknown[];
      metadata: { model: string; latencyMs: number; chunksRetrieved: number };
    };
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.metadata.model).toBeDefined();
    expect(body.metadata.latencyMs).toBeGreaterThan(0);
  }, 30_000);

  it("POST /chat — reuses existing conversation", async () => {
    if (!serverAvailable) return;

    const convRes = await post("/conversations", { title: "Chat test" });
    const { id: conversationId } = (await convRes.json()) as { id: string };

    const res = await post("/chat", { query: "What is RAG?", conversationId });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { conversationId: string };
    expect(body.conversationId).toBe(conversationId);

    await del(`/conversations/${conversationId}`);
  }, 30_000);

  it("GET /chat/stream — returns SSE stream with correct event format", async () => {
    if (!serverAvailable) return;

    const res = await get("/chat/stream?query=What+is+RAG%3F");
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ type: string }> = [];
    let done = false;

    while (!done) {
      const { value, done: d } = await reader.read();
      if (d) break;

      const lines = decoder.decode(value).split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        try {
          const event = JSON.parse(line.replace("data: ", "")) as { type: string };
          events.push(event);
          if (event.type === "done") done = true;
        } catch {
          // skip
        }
      }
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("sources");
    expect(types).toContain("done");
  }, 30_000);
});

// ============================================================
// 404 handler
// ============================================================

describe("404 handler", () => {
  it("returns 404 JSON for unknown routes", async () => {
    if (!serverAvailable) return;

    const res = await get("/this-route-does-not-exist");
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBeDefined();
  });
});
