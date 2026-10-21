import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  countBusinessDays,
  isBusinessDay,
  isWeekend,
  nextBusinessDay,
  previousBusinessDay
} from "./business-days.js";

/** Fixture: só os feriados que os casos abaixo precisam. */
const FERIADOS = new Set([
  "2026-01-01", // quinta
  "2026-02-16", // Carnaval, segunda
  "2026-02-17", // Carnaval, terça
  "2026-09-07", // Independência, segunda
  "2028-02-29" // 29 de fevereiro bissexto, tratado como feriado no teste
]);

describe("fim de semana", () => {
  it("sabado e domingo nao sao dia util", () => {
    expect(isWeekend("2026-02-21")).toBe(true);
    expect(isWeekend("2026-02-22")).toBe(true);
    expect(isBusinessDay("2026-02-21", FERIADOS)).toBe(false);
  });

  it("nao escorrega de fuso: 07/09/2026 e segunda, nao domingo", () => {
    // `new Date("2026-09-07")` lido em fuso negativo voltaria um dia.
    expect(isWeekend("2026-09-07")).toBe(false);
    expect(isBusinessDay("2026-09-07", FERIADOS)).toBe(false); // feriado
  });
});

describe("semana de Carnaval de 2026", () => {
  it("tem 3 dias uteis, nao 5", () => {
    const days = businessDaysBetween("2026-02-16", "2026-02-20", FERIADOS);
    expect(days).toEqual(["2026-02-18", "2026-02-19", "2026-02-20"]);
    expect(countBusinessDays("2026-02-16", "2026-02-20", FERIADOS)).toBe(3);
  });
});

describe("businessDaysBetween", () => {
  it("e fechado nas duas pontas: o mesmo dia util devolve 1", () => {
    expect(businessDaysBetween("2026-09-18", "2026-09-18", FERIADOS)).toEqual(["2026-09-18"]);
  });

  it("devolve vazio quando o fim precede o inicio", () => {
    expect(businessDaysBetween("2026-09-18", "2026-09-17", FERIADOS)).toEqual([]);
  });

  it("atravessa a virada do ano pulando o feriado", () => {
    const days = businessDaysBetween("2025-12-30", "2026-01-02", FERIADOS);
    expect(days).toEqual(["2025-12-30", "2025-12-31", "2026-01-02"]);
  });

  it("conta o 29 de fevereiro de um ano bissexto", () => {
    expect(businessDaysBetween("2028-02-28", "2028-03-01", new Set())).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01"
    ]);
    // Com o dia marcado como feriado na fixture, ele sai da conta.
    expect(businessDaysBetween("2028-02-28", "2028-03-01", FERIADOS)).toEqual([
      "2028-02-28",
      "2028-03-01"
    ]);
  });
});

describe("navegacao", () => {
  it("pula fim de semana e feriado para frente e para tras", () => {
    // Sexta 04/09 → próximo útil é terça 08/09, porque 07/09 é feriado.
    expect(nextBusinessDay("2026-09-04", FERIADOS)).toBe("2026-09-08");
    expect(previousBusinessDay("2026-09-08", FERIADOS)).toBe("2026-09-04");
  });

  it("pula a sequencia inteira do Carnaval", () => {
    expect(nextBusinessDay("2026-02-13", FERIADOS)).toBe("2026-02-18");
  });
});
