// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeriesScope } from "@projeto41/contracts";
import { SeriesScopeDialog } from "./SeriesScopeDialog.js";

/**
 * Este é o componente que a fase 7 vai herdar para lançamentos recorrentes,
 * então ele não pode nascer sem teste.
 */
// O vitest deste repo nao roda com `globals: true`, entao a limpeza
// automatica do Testing Library nao acontece: sem isto, os renders se empilham.
afterEach(cleanup);

function setup(onPick = vi.fn<(scope: SeriesScope) => void>()) {
  const onCancel = vi.fn();
  render(
    <SeriesScopeDialog
      open
      counts={{ one: 1, forward: 4, all: 7 }}
      onPick={onPick}
      onCancel={onCancel}
    />
  );
  return { onPick, onCancel };
}

describe("SeriesScopeDialog", () => {
  it("mostra quantos lancamentos cada escolha afeta", () => {
    setup();
    expect(screen.getByText(/Só esta · 1 lançamento$/)).toBeTruthy();
    expect(screen.getByText(/Esta e as futuras · 4 lançamentos/)).toBeTruthy();
    expect(screen.getByText(/Todas · 7 lançamentos/)).toBeTruthy();
  });

  it("aplica 'one' por padrao", () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onPick).toHaveBeenCalledWith("one");
  });

  it("cada opcao chama onPick com o escopo certo", () => {
    for (const [label, scope] of [
      ["Esta e as futuras", "forward"],
      ["Todas", "all"],
      ["Só esta", "one"]
    ] as const) {
      const { onPick } = setup();
      fireEvent.click(screen.getByRole("tab", { name: label }));
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
      expect(onPick).toHaveBeenCalledWith(scope);
      cleanup();
    }
  });

  it("nao renderiza nada quando fechado", () => {
    const { container } = render(
      <SeriesScopeDialog
        open={false}
        counts={{ one: 1, forward: 1, all: 1 }}
        onPick={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("cancelar nao escolhe escopo nenhum", () => {
    const { onPick, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
