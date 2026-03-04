import type { OAuthTokenProvider } from "./oauth-token-provider.js";
import type { OAuthManager } from "../../application/managers/oauth.manager.js";

export class OAuthManagerAdapter implements OAuthTokenProvider {
  constructor(private readonly oauthManager: OAuthManager) {}

  async getAccessToken(userId: string, scopes: string[]): Promise<string> {
    return this.oauthManager.getAccessToken(userId, scopes);
  }
}
