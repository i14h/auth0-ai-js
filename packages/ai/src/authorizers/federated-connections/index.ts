import {
  Auth0Interrupt,
  FederatedConnectionError,
  FederatedConnectionInterrupt,
} from "../../interrupts";
import { AuthorizerToolParameter, resolveParameter } from "../../parameters";
import { TokenResponse } from "../../TokenResponse";
import { asyncLocalStorage, AsyncStorageValue } from "./asyncLocalStorage";

export type { AsyncStorageValue } from "./asyncLocalStorage";

export { asyncLocalStorage };

export type FederatedConnectionAuthorizerParams<ToolExecuteArgs extends any[]> =
  {
    refreshToken: AuthorizerToolParameter<ToolExecuteArgs, string | undefined>;
    scopes: AuthorizerToolParameter<ToolExecuteArgs, string[]>;
    connection: AuthorizerToolParameter<ToolExecuteArgs, string>;
  };

/**
 * Requests authorization to a third party service via Federated Connection.
 */
export class FederatedConnectionAuthorizerBase<ToolExecuteArgs extends any[]> {
  constructor(
    private readonly auth0: {
      domain: string;
      clientId: string;
      clientSecret: string | undefined;
    },
    private params: FederatedConnectionAuthorizerParams<ToolExecuteArgs>
  ) {}

  protected handleAuthorizationInterrupts(err: Auth0Interrupt) {
    throw err;
  }

  protected validateToken(tokenResponse?: TokenResponse) {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      throw new Error(
        "The tool must be wrapped with the FederationConnectionAuthorizer."
      );
    }

    const { scopes, connection } = store;

    if (!tokenResponse) {
      throw new FederatedConnectionInterrupt(
        `Authorization required to access the Federated Connection: ${this.params.connection}`,
        connection,
        scopes,
        scopes
      );
    }

    const currentScopes = (tokenResponse.scope ?? "").split(" ");
    const missingScopes = scopes.filter((s) => !currentScopes.includes(s));
    store.currentScopes = currentScopes;

    if (missingScopes.length > 0) {
      throw new FederatedConnectionInterrupt(
        `Authorization required to access the Federated Connection: ${
          this.params.connection
        }. Missing scopes: ${missingScopes.join(", ")}`,
        connection,
        scopes,
        [...currentScopes, ...scopes]
      );
    }
  }

  protected async getAccessToken(
    ...toolContext: ToolExecuteArgs
  ): Promise<TokenResponse | undefined> {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      throw new Error(
        "The tool must be wrapped with the FederationConnectionAuthorizer."
      );
    }

    const { connection } = store;

    const subjectToken = await this.getRefreshToken(...toolContext);

    if (!subjectToken) {
      return;
    }

    const exchangeParams = {
      grant_type:
        "urn:auth0:params:oauth:grant-type:token-exchange:federated-connection-access-token",
      client_id: this.auth0.clientId,
      client_secret: this.auth0.clientSecret,
      subject_token_type: "urn:ietf:params:oauth:token-type:refresh_token",
      subject_token: subjectToken,
      connection: connection,
      requested_token_type:
        "http://auth0.com/oauth/token-type/federated-connection-access-token",
    };

    const res = await fetch(`https://${this.auth0.domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exchangeParams),
    });

    if (!res.ok) {
      return;
    }

    return res.json();
  }

  protected async getRefreshToken(...toolContext: ToolExecuteArgs) {
    return await resolveParameter(this.params.refreshToken, toolContext);
  }

  /**
   *
   * Wraps the execute method of an AI tool to handle Federated Connections authorization.
   *
   * @param getContext - A function that returns the context of the tool execution.
   * @param execute - The tool execute method.
   * @returns The wrapped execute method.
   */
  protect(
    getContext: (...args: ToolExecuteArgs) => any,
    execute: (...args: ToolExecuteArgs) => any
  ): (...args: ToolExecuteArgs) => any {
    return async (...args: ToolExecuteArgs) => {
      const asyncStore: AsyncStorageValue<any> = {
        context: await getContext(...args),
        scopes: await resolveParameter(this.params.scopes, args),
        connection: await resolveParameter(this.params.connection, args),
      };

      if (asyncLocalStorage.getStore()) {
        throw new Error(
          "Cannot nest tool calls that require federated connection authorization."
        );
      }

      return asyncLocalStorage.run(asyncStore, async () => {
        try {
          const tokenResponse = await this.getAccessToken(...args);
          this.validateToken(tokenResponse);
          asyncStore.accessToken = tokenResponse!.access_token;
          return await execute(...args);
        } catch (err) {
          if (err instanceof FederatedConnectionError) {
            const interrupt = new FederatedConnectionInterrupt(
              err.message,
              asyncStore.connection,
              asyncStore.scopes,
              asyncStore.scopes
            );
            return this.handleAuthorizationInterrupts(interrupt);
          }
          if (err instanceof Auth0Interrupt) {
            return this.handleAuthorizationInterrupts(err);
          }
          throw err;
        }
      });
    };
  }
}
