import { AuthenticationClient } from "auth0";
import { AsyncLocalStorage } from "node:async_hooks";

import { AuthorizerParams } from "../";
import { Credentials } from "../../credentials";
import {
  AccessDeniedError,
  AuthorizationPending,
  AuthorizationRequestExpiredError,
  UserDoesNotHavePushNotificationsError,
} from "../../errors";

export type AsyncStorageValue<TContext> = {
  credentials?: Credentials;

  /**
   * The tool execution context.
   */
  context: TContext;
};

export const asyncLocalStorage = new AsyncLocalStorage<
  AsyncStorageValue<any>
>();

type ParameterToolRetriever<
  ToolExecuteArgs extends any[],
  TResult extends (AuthorizeResponse | undefined) | string = string
> = TResult | ((...args: ToolExecuteArgs) => Promise<TResult> | TResult);

const retrieveParameter = <
  ToolExecuteArgs extends any[],
  TResult extends (AuthorizeResponse | undefined) | string = string
>(
  resolver: ParameterToolRetriever<ToolExecuteArgs, TResult>,
  context: ToolExecuteArgs
): TResult | Promise<TResult> => {
  if (typeof resolver !== "function") {
    return resolver;
  }
  return resolver(...context);
};

export type CIBAAuthorizerParams<ToolExecuteArgs extends any[]> = {
  userID: ParameterToolRetriever<ToolExecuteArgs>;
  bindingMessage: ParameterToolRetriever<ToolExecuteArgs>;
  scope: string;
  audience?: string;
  requestExpiry?: string;
  subjectIssuerContext?: string;

  /**
   * Given a tool context returns the authorization request data.
   */
  getAuthorizationResponse: ParameterToolRetriever<
    ToolExecuteArgs,
    AuthorizeResponse | undefined
  >;

  storeAuthorizationResponse: (
    request: AuthorizeResponse,
    ...args: ToolExecuteArgs
  ) => Promise<void>;
};

export type AuthorizeResponse = {
  authReqId: string;
  requestedAt: number;
  expiresIn: number;
  interval: number;
};

function ensureOpenIdScope(scope: string): string {
  const scopes = scope.trim().split(/\s+/);

  if (!scopes.includes("openid")) {
    scopes.unshift("openid");
  }

  return scopes.join(" ") || "openid";
}

/**
 * Requests authorization by prompting the user via an out-of-band channel from
 * the backend.
 *
 * @remarks It only supports the polling mode of the CIBA flow.
 */
export class CIBAAuthorizerBase<ToolExecuteArgs extends any[]> {
  auth0: AuthenticationClient;

  constructor(
    auth0: AuthorizerParams,
    private readonly params: CIBAAuthorizerParams<ToolExecuteArgs>
  ) {
    this.auth0 = new AuthenticationClient({
      domain: auth0?.domain || process.env.AUTH0_DOMAIN!,
      clientId: auth0?.clientId || process.env.AUTH0_CLIENT_ID!,
      clientSecret: auth0?.clientSecret || process.env.AUTH0_CLIENT_SECRET,
      clientAssertionSigningAlg: auth0?.clientAssertionSigningAlg,
      clientAssertionSigningKey: auth0?.clientAssertionSigningKey,
      idTokenSigningAlg: auth0?.idTokenSigningAlg,
      clockTolerance: auth0?.clockTolerance,
      useMTLS: auth0?.useMTLS,
    });
  }

  private async start(
    toolContext: ToolExecuteArgs
  ): Promise<AuthorizeResponse> {
    const requestedAt = Date.now() / 1000;
    const authorizeParams = {
      scope: ensureOpenIdScope(this.params.scope),
      binding_message: "",
      userId: "",
      audience: this.params.audience || "",
      request_expiry: this.params.requestExpiry,
      subjectIssuerContext: this.params.subjectIssuerContext,
    };

    authorizeParams.binding_message = await retrieveParameter(
      this.params.bindingMessage,
      toolContext
    );

    authorizeParams.userId = await retrieveParameter(
      this.params.userID,
      toolContext
    );

    const response = await this.auth0.backchannel.authorize(authorizeParams);

    return {
      requestedAt: requestedAt,
      authReqId: response.auth_req_id,
      expiresIn: response.expires_in,
      interval: response.interval,
    };
  }

  protected async getCredentials(
    params: AuthorizeResponse
  ): Promise<Credentials | undefined> {
    try {
      const elapsedSeconds = Date.now() / 1000 - params.requestedAt;

      if (elapsedSeconds >= params.expiresIn) {
        throw new AuthorizationRequestExpiredError(
          "Authorization request has expired"
        );
      }

      const response = await this.auth0.backchannel.backchannelGrant({
        auth_req_id: params.authReqId,
      });

      const credentials = {
        accessToken: {
          type: response.token_type || "bearer",
          value: response.access_token,
        },
      };

      return credentials;
    } catch (e: any) {
      if (e.error == "invalid_request") {
        throw new UserDoesNotHavePushNotificationsError(e.error_description);
      }
      if (e.error == "access_denied") {
        throw new AccessDeniedError(e.error_description);
      }

      if (e.error === "authorization_pending") {
        throw new AuthorizationPending(e.error_description);
      }
      throw e;
    }
  }

  // private async poll(params: AuthorizeResponse): Promise<Credentials> {
  //   return new Promise((resolve, reject) => {
  //     const startTime = Date.now();
  //     const interval = setInterval(async () => {
  //       try {
  //         const elapsedSeconds = (Date.now() - startTime) / 1000;

  //         if (elapsedSeconds >= params.expiresIn) {
  //           clearInterval(interval);
  //           return reject(
  //             new AuthorizationRequestExpiredError(
  //               "Authorization request has expired"
  //             )
  //           );
  //         }

  //         const response = await this.auth0.backchannel.backchannelGrant({
  //           auth_req_id: params.authReqId,
  //         });

  //         const credentials = {
  //           accessToken: {
  //             type: response.token_type || "bearer",
  //             value: response.access_token,
  //           },
  //         };

  //         clearInterval(interval);

  //         return resolve(credentials);
  //       } catch (e: any) {
  //         if (e.error == "invalid_request") {
  //           clearInterval(interval);
  //           return reject(
  //             new UserDoesNotHavePushNotificationsError(e.error_description)
  //           );
  //         }

  //         if (e.error == "access_denied") {
  //           clearInterval(interval);
  //           return reject(new AccessDeniedError(e.error_description));
  //         }

  //         if (e.error == "authorization_pending") {
  //           return;
  //         }
  //       }
  //     }, params.interval * 1000);
  //   });
  // }

  /**
   *
   * Wraps the execute method of a AI tool to handle CIBA authorization.
   *
   * @param getContext - A function that returns the context of the tool execution.
   * @param execute - The tool execute method.
   * @returns The wrapped execute method.
   */
  protected protect(
    getContext: (...args: ToolExecuteArgs) => any,
    execute: (...args: ToolExecuteArgs) => any
  ): (...args: ToolExecuteArgs) => any {
    return async (...args: ToolExecuteArgs) => {
      let authorizeResponse = await retrieveParameter(
        this.params.getAuthorizationResponse,
        args
      );

      if (!authorizeResponse) {
        //Initial request
        authorizeResponse = await this.start(args);
        await this.params.storeAuthorizationResponse(
          authorizeResponse,
          ...args
        );
      }

      const storeValue: AsyncStorageValue<any> = {
        context: getContext(...args),
      };

      if (asyncLocalStorage.getStore()) {
        throw new Error(
          "Cannot nest tool calls that require CIBA authorization."
        );
      }

      return asyncLocalStorage.run(storeValue, async () => {
        const credentials = await this.getCredentials(authorizeResponse);
        storeValue.credentials = credentials;
        return execute(...args);
      });
    };
  }
}
