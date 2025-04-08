import { tool } from "ai";
import { z } from "zod";

import { withSlack } from "@/lib/auth0-ai";
import { getAccessTokenForConnection } from "@auth0/ai-vercel";
import { FederatedConnectionError } from "@auth0/ai/interrupts";
import { ErrorCode, WebClient } from "@slack/web-api";

export const listChannels = withSlack(
  tool({
    description: "List channels for the current user on Slack",
    parameters: z.object({}),
    execute: async () => {
      const credentials = getAccessTokenForConnection();

      try {
        // Slack SDK
        const web = new WebClient(credentials?.accessToken);

        const result = await web.conversations.list({
          exclude_archived: true,
          types: "public_channel,private_channel",
          limit: 10,
        });

        return result.channels?.map((channel) => channel.name);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error) {
          if (error.code === ErrorCode.HTTPError) {
            throw new FederatedConnectionError(
              `Authorization required to access the Federated Connection`
            );
          }
        }

        throw error;
      }
    },
  })
);
