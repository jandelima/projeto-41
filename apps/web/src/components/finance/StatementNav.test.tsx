import { describe, expect, it } from "vitest";
import type { StatementSummary } from "@projeto41/contracts";
import { cycleProgress } from "./StatementNav.js";

const statement = (overrides: Partial<StatementSummary>): StatementSummary =>
  ({
    month: "2026-10",
    closingDate: "2026-10-20",
    dueDate: "2026-10-27",
    status: "open",
    isFuture: false,
    totalCents: 0,
    ...overrides
  }) as StatementSummary;

describe("cycleProgress", () => {
  it("comeca amarelo logo depois do fechamento anterior", () => {
    const progress = cycleProgress(statement({}), undefined, "2026-09-21");
    expect(progress.ratio).toBe(0);
    expect(progress.daysLeft).toBe(29);
  });

  it("chega ao verde no dia do fechamento", () => {
    const progress = cycleProgress(statement({}), undefined, "2026-10-20");
    expect(progress.ratio).toBe(1);
    expect(progress.label).toBe("fecha hoje");
  });

  it("anda proporcionalmente no meio do ciclo", () => {
    const progress = cycleProgress(statement({}), undefined, "2026-10-05");
    expect(progress.ratio).toBeCloseTo(14 / 29, 5);
    expect(progress.label).toBe("fecha em 15 dias");
  });

  it("usa o fechamento da fatura anterior so quando ela e do mes anterior", () => {
    const previous = statement({ month: "2026-09", closingDate: "2026-09-18" });
    // Fechamento anterior no dia 18: o ciclo comeca no 19, nao no 21.
    expect(cycleProgress(statement({}), previous, "2026-09-19").ratio).toBe(0);
    // Uma fatura de tres meses antes nao diz nada sobre este ciclo.
    const far = statement({ month: "2026-07", closingDate: "2026-07-01" });
    expect(cycleProgress(statement({}), far, "2026-09-21").ratio).toBe(0);
  });

  it("respeita o fim do mes ao calcular o fechamento anterior", () => {
    const march = statement({ month: "2026-03", closingDate: "2026-03-31" });
    // Fevereiro de 2026 tem 28 dias: o ciclo comeca em 01/03.
    expect(cycleProgress(march, undefined, "2026-03-01").ratio).toBe(0);
  });

  it("fatura fechada, paga ou vencida ja terminou o ciclo", () => {
    for (const status of ["closed", "paid", "overdue"] as const) {
      expect(cycleProgress(statement({ status }), undefined, "2026-10-01").ratio).toBe(1);
    }
  });
});
