import { describe, expect, it } from "vitest";
import {
  assignToColumns,
  detectColumns,
  groupIntoLines,
  mergeContinuationLines,
  type ColumnSpec
} from "./layout.js";
import type { PdfItem } from "./text-layer.js";

const at = (text: string, x: number, yTop: number, width = text.length * 4, fontHeight = 8): PdfItem => ({
  text,
  x,
  yTop,
  width,
  height: fontHeight,
  fontHeight
});

const SPECS: ColumnSpec<"date" | "category" | "description" | "amount">[] = [
  { key: "date", label: "Data", align: "left" },
  { key: "category", label: "Categoria", align: "left" },
  { key: "description", label: "Descrição", align: "left" },
  { key: "amount", label: "Valor", align: "right" }
];

const HEADER = groupIntoLines([
  at("Data", 50, 230, 20),
  at("Categoria", 120, 230, 35),
  at("Descrição", 370, 230, 36),
  at("Valor", 513, 230, 19)
])[0]!;

describe("groupIntoLines", () => {
  it("agrupa por y com tolerancia proporcional a fonte e ordena por x", () => {
    const lines = groupIntoLines([
      at("b", 100, 100.2),
      at("a", 10, 100),
      at("c", 10, 110),
      // Rodape em fonte menor, a 2pt do anterior: outra linha.
      at("rodape", 10, 113, 20, 5)
    ]);
    expect(lines.map((line) => line.items.map((item) => item.text))).toEqual([
      ["a", "b"],
      ["c"],
      ["rodape"]
    ]);
  });
});

// Como no BTG: titulo centralizado, texto da coluna alinhado a esquerda em
// outra posicao, valor alinhado a direita.
const TABLE = [
  at("28/09/2026", 30, 253),
  at("Transporte", 110, 253),
  at("Uber", 300, 253, 17),
  at("-R$ 7,13", 524.3, 253, 30.7),
  at("28/09/2026", 30, 270),
  at("Cuidados", 110, 265.3),
  at("Pessoais", 110, 274.6),
  at("Academia", 300, 270),
  at("-R$ 80,00", 519.9, 270, 35.1),
  at("28/09/2026", 30, 286),
  at("Viagem", 110, 286),
  at("Panificadora E Pousada Sousa Santos", 300, 286, 138),
  at("R$ 2.212,80", 511.4, 286, 43.6)
];

describe("detectColumns", () => {
  it("a borda de cada coluna vem dos itens, nao da posicao do titulo", () => {
    const columns = detectColumns(HEADER, SPECS, TABLE)!;
    expect(columns.map((column) => [column.key, column.edge])).toEqual([
      ["date", 30],
      ["category", 110],
      ["description", 300],
      ["amount", 555]
    ]);
  });

  it("sem um dos titulos nao ha tabela", () => {
    expect(detectColumns(groupIntoLines([at("Data", 50, 230)])[0]!, SPECS, TABLE)).toBeNull();
  });
});

describe("assignToColumns", () => {
  const columns = detectColumns(HEADER, SPECS, TABLE)!;

  it("texto curto fica na coluna em que comeca, mesmo longe do titulo", () => {
    const row = assignToColumns(TABLE.slice(0, 4), columns);
    expect(row.cells).toEqual({
      date: "28/09/2026",
      category: "Transporte",
      description: "Uber",
      amount: "-R$ 7,13"
    });
    expect(row).toMatchObject({ ambiguous: false, wrapped: false });
  });

  it("junta a celula quebrada em duas linhas e marca como quebrada", () => {
    const row = assignToColumns(TABLE.slice(4, 9), columns);
    expect(row.cells.category).toBe("Cuidados Pessoais");
    expect(row).toMatchObject({ ambiguous: false, wrapped: true });
  });

  it("item que nao alinha com nenhuma coluna marca a linha como ambigua", () => {
    const row = assignToColumns([...TABLE.slice(0, 4), at("??", 230, 253, 20)], columns);
    expect(row.ambiguous).toBe(true);
    expect(row.cells.category).toBe("Transporte ??");
  });
});

describe("mergeContinuationLines", () => {
  it("cada item vai para a data mais proxima; cabecalho e rodape ficam de fora", () => {
    const isDate = (item: PdfItem) => /^\d{2}\/\d{2}\/\d{4}/.test(item.text);
    const groups = mergeContinuationLines(
      [
        at("Data", 50, 230),
        at("28/09/2026", 30, 253),
        at("Uber", 300, 253),
        at("28/09/2026", 30, 270),
        at("Pix enviado por Fulana", 175, 265.3),
        at("Silva", 175, 274.6),
        at("Ouvidoria", 300, 745)
      ],
      isDate
    );
    expect(groups.map((group) => group.items.map((item) => item.text))).toEqual([
      ["28/09/2026", "Uber"],
      ["28/09/2026", "Pix enviado por Fulana", "Silva"]
    ]);
  });
});
