"use client";

import { useQueryState } from "nuqs";
import { FormEventHandler, useEffect, useRef, useState } from "react";

import { FederatedConnectionInterrupt } from "@auth0/ai/interrupts";
import { useStream } from "@langchain/langgraph-sdk/react";

import { EnsureAPIAccessPopup } from "../auth0-ai/FederatedConnections/popup";

const useFocus = () => {
  const htmlElRef = useRef<HTMLInputElement>(null);
  const setFocus = () => {
    if (!htmlElRef.current) {
      return;
    }
    htmlElRef.current.focus();
  };
  return [htmlElRef, setFocus] as const;
};

export default function Chat() {
  const [threadId, setThreadId] = useQueryState("threadId");
  const [input, setInput] = useState("");
  const thread = useStream({
    apiUrl: `${process.env.NEXT_PUBLIC_URL}/api/langgraph`, // Update this with your domain URL (e.g process.env.NEXT_PUBLIC_API_URL)
    assistantId: "agent",
    threadId,

    onThreadId: setThreadId,
    onError: (err) => {
      console.dir(err);
    },
  });
  const [inputRef, setInputFocus] = useFocus();

  useEffect(() => {
    if (thread.isLoading) {
      return;
    }
    setInputFocus();
  }, [thread.isLoading, setInputFocus]);

  // //When the user submits a message, add it to the list of messages and resume the conversation.
  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    thread.submit(
      { messages: [{ type: "human", content: input }] },
      {
        optimisticValues: (prev) => ({
          messages: [
            ...((prev?.messages as []) ?? []),
            { type: "human", content: input, id: "temp" },
          ],
        }),
      }
    );
    setInput("");
  };

  return (
    <div className="flex flex-col w-full max-w-md py-24 mx-auto stretch">
      {thread.messages
        .filter((m) => m.content && ["human", "ai"].includes(m.type))
        .map((message) => (
          <div key={message.id} className="whitespace-pre-wrap">
            {message.type === "human" ? "User: " : "AI: "}
            {message.content as string}
          </div>
        ))}

      {thread.interrupt &&
      FederatedConnectionInterrupt.isInterrupt(thread.interrupt.value) ? (
        <div
          key={thread.interrupt.ns?.join("")}
          className="whitespace-pre-wrap"
        >
          <EnsureAPIAccessPopup
            key={thread.interrupt.ns?.join("")}
            onFinish={() => thread.submit(null)}
            connection={thread.interrupt.value.connection}
            scopes={thread.interrupt.value.requiredScopes}
            connectWidget={{
              title: thread.interrupt.value.message,
              description: "Description...",
              action: { label: "Check" },
            }}
          />
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <input
          className="fixed dark:bg-zinc-900 bottom-0 w-full max-w-md p-2 mb-8 border border-zinc-300 dark:border-zinc-800 rounded shadow-xl"
          value={input}
          ref={inputRef}
          placeholder="Say something..."
          readOnly={thread.isLoading}
          disabled={thread.isLoading}
          onChange={(e) => setInput(e.target.value)}
        />
      </form>
    </div>
  );
}
