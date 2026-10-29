import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat } from "@/server/agent/llm";

const fetchMock = vi.fn<typeof fetch>();

export function sseResponse(frames: string[], split = false): Response {
  const bytes = new TextEncoder().encode(frames.join(""));
  return new Response(new ReadableStream({ start(controller) {
    if (split) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("LLM_MODEL", "test-model");
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("OpenRouter client", () => {
  it("sends configured model, attribution and strict JSON; ignores reasoning", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: '{"items":[]}', reasoning: "private" } }] }));
    expect(await chat({ messages: [{ role: "user", content: "hello" }], response_format: { type: "json_object" } }))
      .toEqual({ content: '{"items":[]}', tool_calls: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key", "X-Title": "Homing", "HTTP-Referer": expect.any(String) });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-model", response_format: { type: "json_object" } });
  });

  it("retries a 5xx exactly once", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "ok" } }] }));
    expect((await chat({ messages: [] })).content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sanitizes provider errors and does not retry a 4xx", async () => {
    fetchMock.mockResolvedValue(new Response("secret provider details", { status: 401 }));
    await expect(chat({ messages: [] })).rejects.toMatchObject({ status: 502, body: { error: { code: "llm_unavailable" } } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps quota to 429", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    await expect(chat({ messages: [] })).rejects.toMatchObject({ status: 429, body: { error: { code: "quota" } } });
  });

  it("assembles interleaved partial tool calls and fragmented UTF-8 SSE", async () => {
    const frame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
    fetchMock.mockResolvedValue(sseResponse([
      ": keepalive\r\n\r\n",
      frame({ content: "Привет", reasoning: "hidden" }),
      frame({ tool_calls: [{ index: 0, id: "a", type: "function", function: { name: "apply_changes", arguments: '{"ops":[' } }, { index: 1, id: "b", function: { name: "get_ranking", arguments: "{" } }] }),
      frame({ tool_calls: [{ index: 1, function: { arguments: "}" } }, { index: 0, function: { arguments: '{"op":"set_days","days":2}]}' } }] }),
      frame({}, "tool_calls"), "data: [DONE]",
    ], true));
    const chunks = [];
    for await (const chunk of chat({ messages: [], stream: true })) chunks.push(chunk);
    expect(chunks).toEqual([
      { type: "content", text: "Привет" },
      { type: "tool_call", call: { id: "a", type: "function", function: { name: "apply_changes", arguments: '{"ops":[{"op":"set_days","days":2}]}' } } },
      { type: "tool_call", call: { id: "b", type: "function", function: { name: "get_ranking", arguments: "{}" } } },
    ]);
  });

  it("rejects truncated streams and partial JSON", async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']));
    await expect((async () => { for await (const chunk of chat({ messages: [], stream: true })) void chunk; })())
      .rejects.toMatchObject({ body: { error: { code: "llm_unavailable" } } });
  });

  it("bounds a stalled response body even when the transport ignores abort", async () => {
    const cancellation = new AbortController();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const work = chat({ messages: [], signal: cancellation.signal });
    cancellation.abort();
    await expect(work).rejects.toMatchObject({ body: { error: { code: "llm_unavailable" } } });
  });
});
