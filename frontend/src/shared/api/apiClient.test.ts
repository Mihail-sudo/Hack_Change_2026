import { describe, expect, it, vi } from "vitest";
import { ApiClientError, apiClient } from "./apiClient";

describe("apiClient", () => {
  it("returns parsed data on successful response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const data = await apiClient<{ ok: boolean }>("/api/test");
    expect(data).toEqual({ ok: true });
  });

  it("throws ApiClientError with SERVER_ERROR on 500 response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));

    await expect(apiClient("/api/test")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      statusCode: 500,
    });
  });

  it("throws ApiClientError with NOT_FOUND on 404 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));

    await expect(apiClient("/api/test")).rejects.toBeInstanceOf(ApiClientError);
  });
});
