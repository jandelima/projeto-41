// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserver);

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          totalBrl: 1000,
          totalUsd: 200,
          usdBrl: 5,
          categories: {},
          annualContributions: 0,
          history: [],
          prices: [],
          portfolios: { crypto: [], b3: [] },
          reserveBrl: 0,
          updatedAt: ""
        })
      )
    );
  });

  it("renders the financial navigation and dashboard", async () => {
    render(<App />);
    expect(await screen.findByText("Patrimônio total")).toBeInTheDocument();
    expect(screen.getByText("Cripto")).toBeInTheDocument();
    expect(screen.getByText("Planejamento")).toBeInTheDocument();
  });
});
