// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { ConfirmProvider } from "../components/dialog.js";
import { PrivacyProvider } from "../lib/privacy.js";
import { ThemeProvider } from "../lib/theme.js";
import { ToastProvider } from "../lib/toast.js";

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserver);

function renderApp() {
  return render(
    <ThemeProvider>
      <PrivacyProvider>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </PrivacyProvider>
    </ThemeProvider>
  );
}

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
          annualReturn: 0,
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
    renderApp();
    expect(await screen.findByText("Patrimônio total")).toBeInTheDocument();
    expect(screen.getByText("Cripto")).toBeInTheDocument();
    expect(screen.getByText("Planejamento")).toBeInTheDocument();
  });
});
