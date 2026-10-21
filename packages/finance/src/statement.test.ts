import { describe, expect, it } from "vitest";
import { addDays, formatIsoDate, parseIsoDate } from "./dates.js";
import {
  clampDay,
  closingDateFor,
  installmentStatementMonth,
  lastDayOfMonth,
  statementDatesFor,
  statementMonthFor,
  statementMonthsBetween,
  statementStatus
} from "./statement.js";

describe("primitivos de calendario", () => {
  it("conhece o ultimo dia do mes, inclusive bissexto", () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
  });

  it("ancora o dia que nao existe no ultimo do mes", () => {
    expect(clampDay(2026, 2, 31)).toBe("2026-02-28");
    expect(clampDay(2028, 2, 31)).toBe("2028-02-29");
    expect(closingDateFor(2026, 4, 31)).toBe("2026-04-30");
  });
});

describe("statementMonthFor", () => {
  it("compra no dia do fechamento entra nessa fatura; no dia seguinte, na proxima", () => {
    expect(statementMonthFor("2026-05-10", 10, 20)).toBe("2026-05");
    expect(statementMonthFor("2026-05-11", 10, 20)).toBe("2026-06");
  });

  it("fechamento 31 fecha em 28 de fevereiro, e em 29 no ano bissexto", () => {
    expect(statementDatesFor(statementMonthFor("2026-02-15", 31, 10), 31, 10).closingDate).toBe(
      "2026-02-28"
    );
    expect(statementDatesFor(statementMonthFor("2028-02-15", 31, 10), 31, 10).closingDate).toBe(
      "2028-02-29"
    );
  });

  it("fechamento 30 e 29 seguem a mesma ancoragem em fevereiro", () => {
    expect(statementDatesFor(statementMonthFor("2027-02-10", 30, 10), 30, 10).closingDate).toBe(
      "2027-02-28"
    );
    expect(statementDatesFor(statementMonthFor("2028-02-10", 29, 10), 29, 10).closingDate).toBe(
      "2028-02-29"
    );
  });

  it("atravessa o ano com vencimento depois do fechamento", () => {
    // Fechamento 05, vencimento 15, compra em 28/12.
    expect(statementMonthFor("2026-12-28", 5, 15)).toBe("2027-01");
    expect(statementDatesFor("2027-01", 5, 15)).toMatchObject({
      closingDate: "2027-01-05",
      dueDate: "2027-01-15"
    });
  });

  it("atravessa o ano com vencimento antes do fechamento", () => {
    // Fechamento 25, vencimento 10, compra em 26/12.
    expect(statementMonthFor("2026-12-26", 25, 10)).toBe("2027-02");
    expect(statementDatesFor("2027-02", 25, 10)).toMatchObject({
      closingDate: "2027-01-25",
      dueDate: "2027-02-10"
    });
  });

  it("due_day igual a closing_day cai na regra <= e vence no mes seguinte", () => {
    expect(statementMonthFor("2026-05-01", 15, 15)).toBe("2026-06");
    expect(statementDatesFor("2026-06", 15, 15)).toMatchObject({
      closingDate: "2026-05-15",
      dueDate: "2026-06-15"
    });
  });

  it("compra em 31 de dezembro com fechamento 31 ainda e da fatura de dezembro", () => {
    expect(statementDatesFor(statementMonthFor("2026-12-31", 31, 10), 31, 10).closingDate).toBe(
      "2026-12-31"
    );
  });
});

describe("installmentStatementMonth", () => {
  it("uma parcela por fatura mesmo quando a data encurtada cai antes do fechamento", () => {
    // Fecha 29, vence 7: 31/01 fecha em 28/02 (vence mar). A 2a parcela (28/02)
    // tambem cairia em marco pela propria data; pela serie, e abril.
    const months = [1, 2, 3].map((n) => installmentStatementMonth("2026-01-31", n, 29, 7));
    expect(months).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(statementMonthFor("2026-02-28", 29, 7)).toBe("2026-03");
  });

  it("a primeira parcela e a fatura da compra", () => {
    expect(installmentStatementMonth("2026-05-10", 1, 20, 27)).toBe(
      statementMonthFor("2026-05-10", 20, 27)
    );
  });
});

describe("statementDatesFor", () => {
  it("delimita o periodo como o dia seguinte ao fechamento anterior", () => {
    expect(statementDatesFor("2026-05", 10, 20)).toEqual({
      closingDate: "2026-05-10",
      dueDate: "2026-05-20",
      periodStart: "2026-04-11",
      periodEnd: "2026-05-10"
    });
  });

  it("e a inversa exata de statementMonthFor", () => {
    for (const [date, closingDay, dueDay] of [
      ["2026-05-10", 10, 20],
      ["2026-12-26", 25, 10],
      ["2026-02-15", 31, 10]
    ] as const) {
      const month = statementMonthFor(date, closingDay, dueDay);
      const dates = statementDatesFor(month, closingDay, dueDay);
      expect(date >= dates.periodStart && date <= dates.periodEnd).toBe(true);
    }
  });
});

describe("propriedades sobre tres anos", () => {
  /** Todas as datas de 2026 a 2028, geradas por aritmetica inteira. */
  function everyDate(): string[] {
    const dates: string[] = [];
    for (let year = 2026; year <= 2028; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= lastDayOfMonth(year, month); day += 1) {
          dates.push(formatIsoDate(year, month, day));
        }
      }
    }
    return dates;
  }

  const dates = everyDate();

  it("a data sempre cai dentro do periodo da fatura devolvida", () => {
    // Cruzamento completo de closingDay e dueDay de 1 a 31 seria ~3 milhoes de
    // combinacoes; a amostragem cobre inicio, meio e fim do mes em ambos.
    const days = [1, 2, 5, 10, 15, 20, 25, 28, 29, 30, 31];
    for (const closingDay of days) {
      for (const dueDay of days) {
        for (const date of dates) {
          const month = statementMonthFor(date, closingDay, dueDay);
          const { periodStart, periodEnd } = statementDatesFor(month, closingDay, dueDay);
          if (date < periodStart || date > periodEnd) {
            throw new Error(
              `${date} (fecha ${closingDay}, vence ${dueDay}) caiu em ${month}, ` +
                `cujo periodo e ${periodStart}..${periodEnd}`
            );
          }
        }
      }
    }
    expect(dates.length).toBeGreaterThan(1000);
  });

  it("o mes da fatura nunca retrocede ao avancar um dia", () => {
    for (const [closingDay, dueDay] of [
      [1, 10],
      [10, 20],
      [20, 5],
      [28, 28],
      [31, 1],
      [31, 31]
    ] as const) {
      let previous = "0000-00";
      for (const date of dates) {
        const month = statementMonthFor(date, closingDay, dueDay);
        if (month < previous) {
          throw new Error(`${date} (fecha ${closingDay}) retrocedeu de ${previous} para ${month}`);
        }
        previous = month;
      }
    }
  });

  it("nao depende do fuso do processo", () => {
    // Um `new Date('2026-03-01')` seria 28/02 em fuso negativo. Como tudo e
    // aritmetica inteira sobre a string, o resultado nao muda com TZ.
    const original = process.env.TZ;
    const sample = ["2026-03-01", "2026-01-01", "2026-12-31"];
    const reference = sample.map((date) => statementMonthFor(date, 31, 10));
    try {
      for (const tz of ["UTC", "America/Sao_Paulo", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        expect(sample.map((date) => statementMonthFor(date, 31, 10))).toEqual(reference);
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("statementMonthsBetween", () => {
  it("devolve a sequencia inclusiva, atravessando o ano", () => {
    expect(statementMonthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02"
    ]);
  });

  it("devolve um unico mes quando inicio e fim coincidem, e vazio quando invertido", () => {
    expect(statementMonthsBetween("2026-05", "2026-05")).toEqual(["2026-05"]);
    expect(statementMonthsBetween("2026-05", "2026-04")).toEqual([]);
  });
});

describe("statementStatus", () => {
  const base = { closingDate: "2026-05-10", dueDate: "2026-05-20", hasPayment: false };

  it("percorre open, closed e overdue conforme o calendario", () => {
    expect(statementStatus({ ...base, today: "2026-05-05", totalCents: 10000 })).toBe("open");
    expect(statementStatus({ ...base, today: "2026-05-10", totalCents: 10000 })).toBe("open");
    expect(statementStatus({ ...base, today: "2026-05-11", totalCents: 10000 })).toBe("closed");
    expect(statementStatus({ ...base, today: "2026-05-21", totalCents: 10000 })).toBe("overdue");
  });

  it("so fica paga quando existe pagamento atribuido ao mes", () => {
    expect(
      statementStatus({ ...base, today: "2026-05-21", totalCents: 0, hasPayment: true })
    ).toBe("paid");
    // Fatura zerada por estorno nao esta paga, esta zerada: fechada, nunca vencida.
    expect(
      statementStatus({ ...base, today: "2026-05-21", totalCents: 0, hasPayment: false })
    ).toBe("closed");
  });
});

describe("dias corridos", () => {
  it("parseIsoDate e addDays sao consistentes na virada de mes", () => {
    expect(parseIsoDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
