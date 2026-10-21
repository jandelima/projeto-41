import { afterEach, describe, expect, it } from "vitest";
import {
  weekdayName,
  budgetPair,
  centsToInput,
  currencyRaw,
  priceFractionDigits,
  todayIso,
  compactMoneyFromCents,
  debtFromCents,
  moneyFromCents,
  setValuesMasked,
  signedMoneyFromCents
} from "./format.js";

afterEach(() => setValuesMasked(false));

describe("formatadores de centavos", () => {
  it("formata em reais a partir de centavos", () => {
    expect(moneyFromCents(123456)).toContain("1.234,56");
    expect(moneyFromCents(0)).toContain("0,00");
  });

  it("mostra o sinal explicito no valor do livro", () => {
    expect(signedMoneyFromCents(5000).startsWith("+")).toBe(true);
    expect(signedMoneyFromCents(-5000)).toContain("-");
  });

  it("reporta divida de cartao sempre positiva", () => {
    expect(debtFromCents(-45000)).toBe(moneyFromCents(45000));
  });

  it("mostra so o gasto quando a categoria nao tem orcamento (6.5)", () => {
    expect(budgetPair(-50000, null)).toBe(moneyFromCents(50000));
    expect(budgetPair(-50000, 80000)).toBe(`${moneyFromCents(50000)} / ${moneyFromCents(80000)}`);
  });

  it("converte centavos para o texto editavel em pt-BR", () => {
    expect(centsToInput(123456)).toBe("1234,56");
    expect(centsToInput(null)).toBe("");
  });
});

// R-04: um formatador novo que ignore a flag vaza valores na gravacao de tela.
describe("modo privacidade", () => {
  it("mascara todos os formatadores monetarios novos", () => {
    setValuesMasked(true);
    expect(moneyFromCents(123456)).not.toContain("1.234");
    expect(moneyFromCents(123456)).toContain("••••");
    expect(signedMoneyFromCents(123456)).toContain("••••");
    expect(compactMoneyFromCents(123456)).toContain("••••");
    expect(debtFromCents(-123456)).toContain("••••");
    expect(budgetPair(-50000, 80000)).not.toContain("500");
    expect(budgetPair(-50000, 80000)).toContain("••••");
  });

  it("nao mascara o campo de edicao, que o usuario precisa enxergar para digitar", () => {
    setValuesMasked(true);
    expect(centsToInput(123456)).toBe("1234,56");
  });
});

describe("todayIso", () => {
  it("usa o dia local, nao o UTC", () => {
    // 23h30 no fuso local: em UTC (Brasil) ja seria o dia seguinte.
    expect(todayIso(new Date(2026, 8, 24, 23, 30))).toBe("2026-09-24");
    expect(todayIso(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});

describe("preços", () => {
  const nbsp = (text: string) => text.replace(/\s/g, " ");

  it("dólar sai no formato brasileiro, como o real", () => {
    expect(nbsp(currencyRaw(1669.27, "USD"))).toBe("US$ 1.669,27");
    expect(nbsp(currencyRaw(612345.67, "BRL"))).toBe("R$ 612.345,67");
  });

  it("preço baixo ganha casas até mostrar o número", () => {
    expect(nbsp(currencyRaw(0.0000123, "USD"))).toBe("US$ 0,0000123");
    expect(nbsp(currencyRaw(0.5, "USD"))).toBe("US$ 0,50");
    expect(nbsp(currencyRaw(0.0421, "BRL"))).toBe("R$ 0,0421");
    expect(priceFractionDigits(350)).toBe(2);
  });
});

describe("weekdayName", () => {
  it("da o dia da semana por extenso e curto", () => {
    expect(weekdayName("2026-09-25")).toBe("Sexta-feira");
    expect(weekdayName("2026-09-27", "short")).toBe("dom");
    expect(weekdayName("")).toBe("");
  });
});
