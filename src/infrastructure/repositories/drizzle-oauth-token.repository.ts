import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { oauthTokens } from "../db/schema.js";
import type { OAuthToken, NewOAuthToken } from "../db/schema.js";
import type { OAuthTokenRepository } from "../../domain/ports/repositories/oauth-token.repository.js";

export class DrizzleOAuthTokenRepository implements OAuthTokenRepository {
  async findByUserAndProvider(userId: string, provider: string): Promise<OAuthToken | null> {
    const result = await db.query.oauthTokens.findFirst({
      where: and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)),
    });
    return result ?? null;
  }

  async upsert(data: NewOAuthToken): Promise<OAuthToken> {
    const [token] = await db
      .insert(oauthTokens)
      .values(data)
      .onConflictDoUpdate({
        target: [oauthTokens.userId, oauthTokens.provider],
        set: {
          accessTokenEncrypted: data.accessTokenEncrypted,
          refreshTokenEncrypted: data.refreshTokenEncrypted,
          tokenExpiry: data.tokenExpiry ?? null,
          scopes: data.scopes ?? "",
          updatedAt: new Date(),
        },
      })
      .returning();
    return token!;
  }

  async deleteByUserAndProvider(userId: string, provider: string): Promise<boolean> {
    const result = await db
      .delete(oauthTokens)
      .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
      .returning({ id: oauthTokens.id });
    return result.length > 0;
  }
}
