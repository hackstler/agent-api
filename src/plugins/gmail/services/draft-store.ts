/**
 * In-memory store for email drafts pending user confirmation.
 * Drafts expire after 10 minutes to prevent stale sends.
 */

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  attachmentFilename?: string | undefined;
  createdAt: number;
}

const DRAFT_TTL_MS = 10 * 60 * 1000; // 10 minutes

const drafts = new Map<string, EmailDraft>();

let counter = 0;

export function saveDraft(draft: Omit<EmailDraft, "createdAt">): string {
  // Purge expired drafts on each save
  const now = Date.now();
  for (const [id, d] of drafts) {
    if (now - d.createdAt > DRAFT_TTL_MS) drafts.delete(id);
  }

  const draftId = `draft-${++counter}`;
  drafts.set(draftId, { ...draft, createdAt: now });
  return draftId;
}

export function takeDraft(draftId: string): EmailDraft | null {
  const draft = drafts.get(draftId);
  if (!draft) return null;

  if (Date.now() - draft.createdAt > DRAFT_TTL_MS) {
    drafts.delete(draftId);
    return null;
  }

  drafts.delete(draftId); // one-time use
  return draft;
}
