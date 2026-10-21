import { describe, expect, it } from "vitest";
import { paginateByDay } from "./ledger-pages.js";

/** `spec` é a quantidade de linhas de cada dia, do mais recente ao mais antigo. */
const rows = (spec: number[]) =>
  spec.flatMap((count, day) =>
    Array.from({ length: count }, (_, index) => ({ date: `2026-09-${String(30 - day).padStart(2, "0")}`, index }))
  );
const shape = (pages: { date: string }[][]) =>
  pages.map((page) => page.map((row) => row.date.slice(-2)).join(","));

describe("paginateByDay", () => {
  it("o dia que não cabe vai inteiro para a próxima página", () => {
    const pages = paginateByDay(rows([2, 2, 2]), 5);
    expect(shape(pages)).toEqual(["30,30,29,29", "28,28"]);
  });

  it("enche a página exatamente quando o dia cabe", () => {
    expect(paginateByDay(rows([3, 2, 1]), 5).map((page) => page.length)).toEqual([5, 1]);
  });

  it("só divide o dia que sozinho passa do limite", () => {
    const pages = paginateByDay(rows([1, 7, 1]), 3);
    // O dia 30 sai sozinho; o 29, com 7 linhas, vira 3 + 3 + 1 e o resto
    // divide a página com o dia 28.
    expect(pages.map((page) => page.length)).toEqual([1, 3, 3, 2]);
    expect(shape(pages)[3]).toBe("29,28");
  });

  it("lista vazia não tem página", () => {
    expect(paginateByDay([], 50)).toEqual([]);
  });
});
