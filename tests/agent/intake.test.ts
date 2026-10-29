import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractTastes, EMPTY_INTAKE_MESSAGE, MAX_IMAGE_BYTES, validateImage } from "@/server/agent/intake";
import { POST } from "@/app/api/intake/route";
import { chat } from "@/server/agent/llm";
import { searchEntities } from "@/server/qloo";

vi.mock("@/server/agent/llm", () => ({ chat: vi.fn() }));
vi.mock("@/server/qloo", () => ({ searchEntities: vi.fn() }));

const model = vi.mocked(chat);
const search = vi.mocked(searchEntities);
const png = "data:image/png;base64,iVBORw0KGgo=";

export function extractReply(items: { name: string; kind: string }[], city?: string): void {
  model.mockReturnValue(Promise.resolve({ content: JSON.stringify({ items, ...(city ? { city } : {}) }), tool_calls: [] }));
}

beforeEach(() => { vi.clearAllMocks(); search.mockResolvedValue([]); });

describe("taste intake", () => {
  it("resolves mixed tastes in parallel, preserves ambiguity and extracts a city", async () => {
    extractReply([{ name: "Radiohead", kind: "artist" }, { name: "Fleabag", kind: "tv_show" }, { name: "natural wine bars", kind: "unknown" }], "Berlin");
    search.mockImplementation(async (name) => name === "Radiohead" ? [{ id: "r", name: "RADIOHEAD", domain: "artist" }] :
      name === "Fleabag" ? [{ id: "f", name: "Fleabag (2016)", domain: "tv_show", popularity: 0.8 }] :
        [{ id: "w", name: "Wine Bar", domain: "place", popularity: 0.5 }]);
    const result = await extractTastes({ text: "I love Radiohead, Fleabag and natural wine bars, moving to Berlin" });
    expect(result.city).toBe("Berlin");
    expect(result.loves.map((l) => l.chosen?.id ?? null)).toEqual(["r", "f", null]);
    expect(result.loves[2].candidates).toHaveLength(1);
    expect(search.mock.calls).toEqual([["Radiohead", "artist"], ["Fleabag", "tv_show"], ["natural wine bars", undefined]]);
  });

  it("deduplicates normalized names and retains unmatched visible titles", async () => {
    extractReply([{ name: "Björk", kind: "artist" }, { name: "Bjork", kind: "artist" }, { name: "Visible Book", kind: "book" }]);
    const result = await extractTastes({ image: png });
    expect(result.loves.map((l) => l.query)).toEqual(["Björk", "Visible Book"]);
    expect(result.loves.every((l) => l.chosen === null)).toBe(true);
    expect(model.mock.calls[0][0]).toMatchObject({ response_format: { type: "json_object" }, messages: expect.arrayContaining([
      { role: "user", content: [{ type: "image_url", image_url: { url: png } }] },
    ]) });
  });

  it("returns the requested empty-input guidance", async () => {
    extractReply([]);
    await expect(extractTastes({ text: "hello" })).rejects.toMatchObject({ status: 400, body: { error: { message: EMPTY_INTAKE_MESSAGE } } });
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects invented domains, too many extracted items and malformed JSON as model failures", async () => {
    extractReply([{ name: "x", kind: "genre" }]);
    await expect(extractTastes({ text: "x" })).rejects.toMatchObject({ status: 502 });
    extractReply(Array.from({ length: 9 }, (_, i) => ({ name: `x${i}`, kind: "unknown" })));
    await expect(extractTastes({ text: "x" })).rejects.toMatchObject({ status: 502 });
    model.mockReturnValue(Promise.resolve({ content: "```json {} ```", tool_calls: [] }));
    await expect(extractTastes({ text: "x" })).rejects.toMatchObject({ status: 502 });
  });

  it("validates image size, encoding, MIME and contents before model access", async () => {
    expect(() => validateImage(png)).not.toThrow();
    for (const image of ["https://example.com/a.png", "data:image/gif;base64,R0lG", "data:image/png;base64,a===", "data:image/jpeg;base64,iVBORw0KGgo=", "x".repeat(MAX_IMAGE_BYTES + 1)]) {
      await expect(extractTastes({ image })).rejects.toMatchObject({ status: 400 });
    }
    expect(model).not.toHaveBeenCalled();
  });

  it("returns ApiError for invalid JSON and propagates upstream quota", async () => {
    const invalid = await POST(new Request("http://localhost/api/intake", { method: "POST", body: "{" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "bad_input", retryable: false } });
    extractReply([{ name: "Radiohead", kind: "artist" }]);
    search.mockRejectedValue({ error: { code: "quota", message: "Try later", retryable: true } });
    const response = await POST(new Request("http://localhost/api/intake", { method: "POST", body: JSON.stringify({ text: "Radiohead" }) }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "quota" } });
  });
});
