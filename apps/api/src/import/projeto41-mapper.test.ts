import { describe, expect, it } from "vitest";
import { mapWorkbook } from "./projeto41-mapper.js";

describe("mapWorkbook", () => {
  it("maps operations, manual positions and allocation targets", () => {
    const workbook = {
      Operations: [
        ["Date", "Type", "Asset", "Amount", "Value (USD)"],
        [new Date("2026-01-10"), "Buy", "BTC", 0.1, 5000]
      ],
      Operações: [
        ["Data", "Tipo", "Ativo", "Quantidade", "Preço", "Valor"],
        [new Date("2026-02-10"), "Compra", "PETR4", 10, 40, 400]
      ],
      Overview: [],
      Fixa: [],
      History: [],
      Aportes: [],
      MODELO: [
        ["Ativo", "Saldo Ideal"],
        ["Bitcoin", { formula: "0.35*(Overview!B9-Overview!B20)", value: 350 }]
      ],
      Planning: []
    } as any;

    const result = mapWorkbook(workbook);

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]).toMatchObject({ portfolio: "crypto", type: "buy" });
    expect(result.operations[1]).toMatchObject({ portfolio: "b3", asset: "PETR4" });
    expect(result.targets).toContainEqual({ category: "bitcoin", weight: 0.35 });
  });

  it("preserves direct asset balances without inventing a cost basis", () => {
    const result = mapWorkbook({
      Operations: [["Date", "Type", "Asset", "Amount", "Value (USD)"]],
      Assets: [
        ["Asset", "Amount"],
        ["POL", 13.5]
      ]
    } as any);

    expect(result.operations).toContainEqual(
      expect.objectContaining({
        asset: "POL",
        quantity: 13.5,
        total: 0,
        notes: "Saldo inicial sem custo informado"
      })
    );
  });
});
