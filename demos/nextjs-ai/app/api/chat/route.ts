import { createDataStreamResponse, generateId, Message, streamText } from "ai";

import { buyStock } from "@/lib/ai/tools/buy-stock";
import { checkUsersCalendar } from "@/lib/ai/tools/check-user-calendar";
import { listChannels } from "@/lib/ai/tools/list-channels";
import { listRepositories } from "@/lib/ai/tools/list-repositories";
import { openai } from "@ai-sdk/openai";
import { setAIContext } from "@auth0/ai-vercel";
import { errorSerializer, invokeTools } from "@auth0/ai-vercel/interrupts";

export const maxDuration = 30;

export async function POST(request: Request) {
  const {
    id,
    messages,
  }: { id: string; messages: Array<Message>; selectedChatModel: string } =
    await request.json();

  setAIContext({ threadID: id });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      await invokeTools({
        messages,
        tools: {
          checkUsersCalendar,
          listRepositories,
          listChannels,
        },
      });

      const result = streamText({
        model: openai("gpt-4o-mini"),
        system:
          "You are a friendly assistant! Keep your responses concise and helpful.",
        messages,
        maxSteps: 5,

        experimental_activeTools: [
          "checkUsersCalendar",
          "listRepositories",
          "listChannels",
          "buyStock",
        ],
        experimental_generateMessageId: generateId,
        tools: {
          buyStock,
          checkUsersCalendar,
          listRepositories,
          listChannels,
        },
      });

      result.mergeIntoDataStream(dataStream, {
        sendReasoning: true,
      });
    },
    onError: errorSerializer((err) => {
      console.log(err);
      return "Oops, an error occured!";
    }),
  });
}
