import { Schema, Tool, ToolExecutionOptions } from "ai";
import crypto from "crypto";
import { stableHash } from "stable-hash";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { aiContext } from "../context";

type Parameters = z.ZodTypeAny | Schema<any>;

//Vercel AI tools don't have a name,
// so we use the description plus parameters
// name to fabricate an id
const getToolID = (tool: Tool) => {
  const params = zodToJsonSchema(tool.parameters);
  const sh = stableHash({ description: tool.description, parameters: params });
  return crypto.createHash("MD5").update(sh).digest("hex");
};

export const ToolContext = <PARAMETERS extends Parameters = any, RESULT = any>(
  tool: Tool<PARAMETERS, RESULT>
) => {
  return (_params: any, ctx: ToolExecutionOptions) => {
    const aictx = aiContext.getStore();
    if (!aictx?.threadID) {
      throw new Error(
        "No AI context found. Make sure to call setAIContext({threadID}) from '@auth0/ai-vercel'"
      );
    }
    const threadID = aictx.threadID;
    return {
      threadID,
      toolCallID: ctx.toolCallId,
      toolName: getToolID(tool),
    };
  };
};
