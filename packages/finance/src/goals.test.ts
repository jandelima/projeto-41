import { describe, expect, it } from "vitest";
import { projectCompletion } from "./goals.js";

describe("projectCompletion", () => {
  it("mes sem deposito dentro da janela conta como zero no ritmo", () => {
    const result = projectCompletion({
      balanceCents: 300000,
      targetAmountCents: 600000,
      // Um deposito so em julho; agosto e setembro sem nada.
      depositsByMonth: { "2026-07": 300000 },
      asOf: "2026-10-15"
    });
    expect(result.monthlyDepositCents).toBe(100000);
    expect(result.estimatedDate).toBe("2027-01-01");
  });

  it("caixinha mais nova que a janela tira a media desde o primeiro aporte", () => {
    const result = projectCompletion({
      balanceCents: 200000,
      targetAmountCents: 400000,
      depositsByMonth: { "2026-08": 100000, "2026-09": 100000 },
      asOf: "2026-10-15"
    });
    expect(result.monthlyDepositCents).toBe(100000);
  });

  it("sem deposito e sem rendimento nao estima data", () => {
    const result = projectCompletion({
      balanceCents: 0,
      targetAmountCents: 100000,
      depositsByMonth: {},
      asOf: "2026-10-15"
    });
    expect(result.estimatedDate).toBeNull();
  });
});
