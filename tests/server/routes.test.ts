import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/contracts";
import { qlooGet } from "@/server/qloo/client";
import { GET as search } from "@/app/api/search/route";
import { GET as tags } from "@/app/api/tags/route";
import { POST as field } from "@/app/api/field/route";
import { POST as neighborhoods } from "@/app/api/neighborhoods/route";
import { POST as places } from "@/app/api/places/route";
import { POST as plan } from "@/app/api/plan/route";
import { POST as fingerprint } from "@/app/api/fingerprint/route";
import { errorResponse } from "@/server/engine/http";
import { state } from "./helpers";

vi.mock("@/server/qloo/client", async (original) => ({ ...await original<typeof import("@/server/qloo/client")>(), qlooGet: vi.fn() }));
beforeEach(() => { vi.mocked(qlooGet).mockReset(); });

describe("API error contract", () => {
  it.each([field, neighborhoods, places, plan, fingerprint])("rejects malformed JSON and invalid payloads with ApiError", async (handler) => {
    for (const body of ["{", "{}", JSON.stringify({ ...state(), discovery: 2 })]) {
      const response = await handler(new Request("https://example.test/api", { method: "POST", body }));
      expect(response.status).toBe(400);
      expect(ApiError.parse(await response.json()).error.code).toBe("bad_input");
    }
  });

  it("validates search input and maps upstream failures", async () => {
    for (const url of ["https://example.test/api/search", "https://example.test/api/search?q=x&domain=unknown"]) expect((await search(new Request(url))).status).toBe(400);
    expect((await tags(new Request("https://example.test/api/tags?q=%20"))).status).toBe(400);
    vi.mocked(qlooGet).mockRejectedValue({ error: { code: "quota", message: "Quota", retryable: true } });
    const response = await search(new Request("https://example.test/api/search?q=x"));
    expect(response.status).toBe(429);
    expect(ApiError.parse(await response.json()).error.code).toBe("quota");
  });

  it.each([["not_found", 404], ["qloo_unavailable", 502], ["llm_unavailable", 502], ["bad_input", 400]])("maps %s to %s", (code, status) => {
    expect(errorResponse({ error: { code, message: "Test", retryable: false } }).status).toBe(status);
  });
});
