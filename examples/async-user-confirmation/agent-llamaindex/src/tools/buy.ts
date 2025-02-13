import "dotenv/config";

import { FunctionTool } from "llamaindex";
import z from "zod";

import { CIBAAuthorizer } from "@auth0/ai";

import { Context } from "../context";

const ciba = CIBAAuthorizer.create();

export const buyTool = (context: Context) => {
  const useCiba = ciba({
    userId: context.userId,
    binding_message: async ({ ticker, qty }) =>
      `Do you want to buy ${qty} shares of ${ticker}`,
    scope: "openid buy:stocks",
    audience: process.env["AUDIENCE"]!,
  });

  return FunctionTool.from(
    useCiba(
      async (
        { accessToken },
        { ticker, qty }: { ticker: string; qty: number }
      ) => {
        const headers = {
          "Content-Type": "application/json",
        };
        const body = {
          ticker: ticker,
          qty: qty,
        };

        if (accessToken) {
          headers["Authorization"] = "Bearer " + accessToken;
        }

        const response = await fetch(process.env["API_URL"]!, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(body),
        });

        return response.statusText;
      }
    ),
    {
      name: "buy",
      description: "Use this function to buy stock",
      parameters: z.object({
        ticker: z.string(),
        qty: z.number(),
      }),
    }
  );
};
