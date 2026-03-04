import type { OAuthToken, NewOAuthToken } from "../../entities/index.js";

export interface OAuthTokenRepository {
  findByUserAndProvider(userId: string, provider: string): Promise<OAuthToken | null>;
  upsert(data: NewOAuthToken): Promise<OAuthToken>;
  deleteByUserAndProvider(userId: string, provider: string): Promise<boolean>;
}
