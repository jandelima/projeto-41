import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  clampDayToMonth,
  daysBetween,
  daysInMonth,
  endOfMonth,
  installmentDates,
  startOfMonth,
  statementCycleFor,
  statementMonthFor
} from "./dates.js";

describe("aritmetica de calendario", () => {
  it("conhece o tamanho dos meses, inclusive bissexto", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("ancora um dia que nao existe no ultimo dia do mes", () => {
    expect(clampDayToMonth(2026, 2, 31)).toBe("2026-02-28");
    expect(clampDayToMonth(2026, 3, 31)).toBe("2026-03-31");
  });

  it("atravessa a virada do ano ao somar meses", () => {
    expect(addMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 });
    expect(addMonths({ year: 2026, month: 2 }, -3)).toEqual({ year: 2025, month: 11 });
  });

  it("soma dias sem escorregar de fuso", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
  });

  it("delimita o mes", () => {
    expect(startOfMonth("2026-02")).toBe("2026-02-01");
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
  });
});

describe("statementCycleFor", () => {
  // Cartao que fecha dia 20 e vence dia 27 do mesmo mes.
  it("coloca a compra na fatura do proprio mes quando ela antecede o fechamento", () => {
    expect(statementCycleFor("2026-03-10", 20, 27)).toEqual({
      statementMonth: "2026-03",
      closingDate: "2026-03-20",
      dueDate: "2026-03-27"
    });
  });

  it("compra no dia do fechamento entra nessa fatura, nao na seguinte", () => {
    expect(statementMonthFor("2026-03-20", 20, 27)).toBe("2026-03");
    expect(statementMonthFor("2026-03-21", 20, 27)).toBe("2026-04");
  });

  it("joga o vencimento para o mes seguinte quando due_day <= closing_day", () => {
    expect(statementCycleFor("2026-03-10", 28, 5)).toEqual({
      statementMonth: "2026-04",
      closingDate: "2026-03-28",
      dueDate: "2026-04-05"
    });
  });

  it("usa o ultimo dia do mes quando o fechamento e dia 31", () => {
    expect(statementCycleFor("2026-02-28", 31, 10)).toEqual({
      statementMonth: "2026-03",
      closingDate: "2026-02-28",
      dueDate: "2026-03-10"
    });
  });

  it("atravessa a virada do ano", () => {
    expect(statementCycleFor("2026-12-25", 20, 5)).toEqual({
      statementMonth: "2027-02",
      closingDate: "2027-01-20",
      dueDate: "2027-02-05"
    });
  });
});

describe("installmentDates", () => {
  it("mantem o dia da compra nos meses seguintes", () => {
    expect(installmentDates("2026-01-15", 3)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("ancora o dia 31 no ultimo dia de cada mes", () => {
    expect(installmentDates("2026-01-31", 4)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30"
    ]);
  });
});
