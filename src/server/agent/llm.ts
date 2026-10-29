import { z } from "zod";
import { asFailure, fail, withSignal } from "./errors";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
export type ChatTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type ChatOptions = {
  messages: ChatMessage[];
  tools?: ChatTool[];
  stream?: boolean;
  response_format?: { type: "json_object" };
  signal?: AbortSignal;
};
export type ChatResult = { content: string; tool_calls: ToolCall[] };
export type ChatChunk = { type: "content"; text: string } | { type: "tool_call"; call: ToolCall };

const toolCallSchema = z.object({
  id: z.string().min(1), type: z.literal("function"),
  function: z.object({ name: z.string().min(1), arguments: z.string() }),
});
const messageSchema = z.object({ content: z.string().nullable().optional(), tool_calls: z.array(toolCallSchema).optional() });
const deltaSchema = z.object({
  content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({
    index: z.number().int().nonnegative(), id: z.string().optional(), type: z.literal("function").optional(),
    function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
  })).optional(),
});

export async function openCompletion(options: ChatOptions, signal: AbortSignal): Promise<Response> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw fail("llm_unavailable", "The assistant is not configured.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await withSignal(fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal, cache: "no-store",
      headers: {
        Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000", "X-Title": "Homing",
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "google/gemini-3.8-flash", messages: options.messages,
        tools: options.tools?.length ? options.tools : undefined,
        stream: options.stream ?? false, response_format: options.response_format,
      }),
    }), signal);
    if (response.status >= 500 && attempt === 0) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw fail("quota", "The assistant has reached its request limit. Please try again shortly.", 429, true);
      throw fail("llm_unavailable", "The assistant is temporarily unavailable. Please try again.", 502, true);
    }
    return response;
  }
  throw fail("llm_unavailable", "The assistant is temporarily unavailable.", 502, true);
}

/** Accepts fragmented UTF-8, CRLF, multiline data and a final frame without a newline. */
export async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await withSignal(reader.read(), signal);
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (chunk.done && buffer) { lines.push(buffer); buffer = ""; }
      for (const raw of lines) {
        const line = raw.replace(/\r$/, "");
        if (line === "" && data.length) { yield data.join("\n"); data = []; }
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (chunk.done) { if (data.length) yield data.join("\n"); break; }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* streamCompletion(options: ChatOptions): AsyncGenerator<ChatChunk> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  try {
    const response = await openCompletion({ ...options, stream: true }, signal);
    if (!response.body) throw fail("llm_unavailable", "The assistant returned an empty stream.", 502, true);
    const calls = new Map<number, ToolCall>();
    let finished = false;
    for await (const data of readSseData(response.body, signal)) {
      if (data.trim() === "[DONE]") { finished = true; break; }
      const frame = z.object({ choices: z.array(z.object({ delta: deltaSchema, finish_reason: z.string().nullable().optional() })) }).parse(JSON.parse(data));
      const choice = frame.choices[0];
      if (!choice) continue;
      if (choice.delta.content) yield { type: "content", text: choice.delta.content };
      for (const part of choice.delta.tool_calls ?? []) {
        const call = calls.get(part.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        if (call.function.arguments.length > 100_000 || calls.size > 32) throw fail("llm_unavailable", "The assistant returned an oversized tool call.");
        calls.set(part.index, call);
      }
      if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") throw fail("llm_unavailable", "The assistant could not complete its response.", 502, true);
      if (choice.finish_reason) finished = true;
    }
    if (!finished) throw fail("llm_unavailable", "The assistant response was interrupted.", 502, true);
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) yield { type: "tool_call", call: toolCallSchema.parse(call) };
  } catch (error) { throw asFailure(error); }
}

export function chat(options: ChatOptions & { stream: true }): AsyncGenerator<ChatChunk>;
export function chat(options: ChatOptions & { stream?: false }): Promise<ChatResult>;
export function chat(options: ChatOptions): AsyncGenerator<ChatChunk> | Promise<ChatResult>;
export function chat(options: ChatOptions): AsyncGenerator<ChatChunk> | Promise<ChatResult> {
  return options.stream ? streamCompletion(options) : completeChat(options);
}

export async function completeChat(options: ChatOptions): Promise<ChatResult> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  try {
    const response = await openCompletion({ ...options, stream: false }, signal);
    const payload = z.object({ choices: z.array(z.object({ message: messageSchema, finish_reason: z.string().nullable().optional() })).min(1) })
      .parse(await withSignal(response.json(), signal));
    const choice = payload.choices[0];
    if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") throw fail("llm_unavailable", "The assistant could not complete its response.", 502, true);
    return { content: choice.message.content ?? "", tool_calls: choice.message.tool_calls ?? [] };
  } catch (error) { throw asFailure(error); }
}
