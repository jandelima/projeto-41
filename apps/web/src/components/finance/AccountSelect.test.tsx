// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSelect } from "./AccountSelect.js";

vi.mock("../../lib/api.js", () => ({
  api: async () => [
    { id: 9, name: "Cartão", kind: "credit_card", personName: "Bianca", currentBalanceCents: 0 },
    { id: 14, name: "BTG conjunta", kind: "checking", personName: "Conjunto", currentBalanceCents: 100 },
    { id: 5, name: "Nubank Bianca", kind: "checking", personName: "Bianca", currentBalanceCents: 200 }
  ]
}));

afterEach(cleanup);

function Harness({ allowNone = false }: { allowNone?: boolean }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <>
      <AccountSelect value={value} onChange={setValue} allowNone={allowNone} exclude={["credit_card"]} />
      <output>{value ?? "vazio"}</output>
    </>
  );
}

describe("AccountSelect", () => {
  it("adota a conta que a tela mostra como escolhida", async () => {
    render(<Harness />);
    // A primeira conta usável, não a primeira da lista (o cartão fica de fora).
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("14"));
    expect(screen.getByRole("combobox")).toHaveValue("14");
  });

  it("com a opção de nenhuma, continua vazio", async () => {
    render(<Harness allowNone />);
    await screen.findByText(/BTG conjunta/);
    expect(screen.getByRole("status")).toHaveTextContent("vazio");
  });
});
