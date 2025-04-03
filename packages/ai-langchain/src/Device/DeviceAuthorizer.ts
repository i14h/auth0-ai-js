import z from "zod";

import { DeviceAuthorizerBase } from "@auth0/ai/Device";
import { DeviceInterrupts } from "@auth0/ai/interrupts";
import { DynamicStructuredTool, tool } from "@langchain/core/tools";
import { LangGraphRunnableConfig } from "@langchain/langgraph";

import { toGraphInterrupt } from "../util/interrrupt";
import { ToolContext } from "../util/ToolContext";
import { ToolWrapper } from "../util/ToolWrapper";

export type ZodObjectAny = z.ZodObject<any, any, any, any>;

/**
 * Authorizer for federated connections.
 */
export class DeviceAuthorizer extends DeviceAuthorizerBase<
  [any, LangGraphRunnableConfig]
> {
  protected override handleAuthorizationInterrupts(
    err:
      | DeviceInterrupts.AuthorizationPendingInterrupt
      | DeviceInterrupts.AuthorizationPollingInterrupt
  ): void {
    throw toGraphInterrupt(err);
  }

  authorizer(): ToolWrapper {
    return <T extends ZodObjectAny = ZodObjectAny>(
      t: DynamicStructuredTool<T>
    ) => {
      return tool(this.protect(ToolContext(t), t.invoke.bind(t)), {
        name: t.name,
        description: t.description,
        schema: t.schema,
      }) as unknown as DynamicStructuredTool<T>;
    };
  }
}
