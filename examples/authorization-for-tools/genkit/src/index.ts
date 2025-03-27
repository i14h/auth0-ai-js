import "dotenv/config";

import Enquirer from "enquirer";
import { genkit } from "genkit/beta";
import { gpt4o, openAI } from "genkitx-openai";

import { Context } from "./context";
import { systemPrompt } from "./system";
import { buyTool } from "./tools/buy";

const ai = genkit({
  plugins: [openAI({ apiKey: process.env.OPENAI_API_KEY })],
  model: gpt4o,
});

async function main() {
  try {
    console.log(`<Enter a command (type "exit" to quit)>\n\n`);

    const session = ai.createSession<Context>({
      initialState: {
        userId: "john",
      },
    });

    const chat = session.chat({
      system: systemPrompt,
      tools: [buyTool(ai)],
    });
    const enquirer = new Enquirer<{ message: string }>();

    while (true) {
      const { message } = await enquirer.prompt({
        type: "text",
        name: "message",
        message: "    ",
        prefix: "User",
      });

      if (message.toLowerCase() === "exit") {
        console.log("Goodbye!");
        break;
      }

      const { text } = await chat.send({
        prompt: message,
      });

      console.log(`Assistant · ${text}\n`);
    }
  } catch (error) {
    console.log("AGENT:error", error);
  }
}

main().catch(console.error);
