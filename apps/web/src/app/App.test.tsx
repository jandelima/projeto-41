// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // Sem `globals`, o Testing Library nao desmonta sozinho: o que ficasse
  // montado renderizaria depois do ambiente desfeito.
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

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

  it("troca o menu inteiro ao mudar de modulo", async () => {
    renderApp();
    await screen.findByText("Patrimônio total");
    const switcher = screen.getByRole("tablist", { name: "Módulo" });
    fireEvent.click(within(switcher).getByRole("tab", { name: /Finanças/ }));

    expect(within(switcher).getByRole("tab", { name: /Finanças/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(document.documentElement.dataset.module).toBe("finance");
    expect(screen.getByRole("button", { name: "Fatura" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cripto" })).not.toBeInTheDocument();
    // Cotacoes sao assunto dos investimentos.
    expect(screen.queryByText("Atualizar preços")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("projeto41-module")).toBe("finance");
  });
});
