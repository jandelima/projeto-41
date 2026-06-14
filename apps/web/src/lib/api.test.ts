import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("does not declare an empty request body as JSON", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);

    await api("/prices/refresh", { method: "POST" });

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const options = calls[0]![1];
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).has("Content-Type")).toBe(false);
  });

  it("sets the JSON content type when a request has a body", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);

    await api("/positions", { method: "POST", body: JSON.stringify({ amount: 1 }) });

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const options = calls[0]![1];
    expect(new Headers(options.headers).get("Content-Type")).toBe("application/json");
  });
});
