export type PositionOperation = {
  type: "buy" | "sell";
  quantity: number;
  total: number;
};

export type PositionResult = {
  quantity: number;
  invested: number;
  averagePrice: number;
  soldValue: number;
  marketValue: number;
  currentReturn: number;
  totalReturn: number;
  dividends: number;
};

export function calculatePosition(
  operations: PositionOperation[],
  currentPrice: number,
  dividends = 0
): PositionResult {
  const buys = operations.filter((operation) => operation.type === "buy");
  const sells = operations.filter((operation) => operation.type === "sell");
  const boughtQuantity = sum(buys.map((operation) => operation.quantity));
  const soldQuantity = sum(sells.map((operation) => operation.quantity));
  const quantity = boughtQuantity - soldQuantity;
  const invested = sum(buys.map((operation) => operation.total));
  const averagePrice = boughtQuantity > 0 ? invested / boughtQuantity : 0;
  const soldValue = sum(sells.map((operation) => operation.total));
  const marketValue = quantity * currentPrice;

  return {
    quantity,
    invested,
    averagePrice,
    soldValue,
    marketValue,
    currentReturn: averagePrice > 0 ? currentPrice / averagePrice - 1 : 0,
    totalReturn: invested > 0 ? (marketValue + soldValue + dividends) / invested - 1 : 0,
    dividends
  };
}

export function calculateAllocation(
  total: number,
  excludedReserve: number,
  targetWeight: number
) {
  const investableTotal = total - excludedReserve;
  const ideal = investableTotal * targetWeight;
  return { investableTotal, ideal, difference: ideal };
}

export type PlanningInput = {
  initialCapital: number;
  monthlyContribution: number;
  monthlyReturnPercent: number;
  months: number;
  annualInflationPercent: number;
  initialYear: number;
};

export type PlanningYear = {
  year: number;
  annualContribution: number;
  nominalBalance: number;
  realBalance: number;
  realMonthlyIncome: number;
};

export function projectWealth(input: PlanningInput): PlanningYear[] {
  const years = Math.round(input.months / 12);
  const monthlyReturn = input.monthlyReturnPercent / 100;
  const monthlyInflation = (1 + input.annualInflationPercent / 100) ** (1 / 12) - 1;
  const result: PlanningYear[] = [];
  let nominal = input.initialCapital;

  for (let year = 1; year <= years; year += 1) {
    const correctedContribution =
      input.monthlyContribution * (1 + input.annualInflationPercent / 100) ** (year - 1);
    for (let month = 0; month < 12; month += 1) {
      nominal = nominal * (1 + monthlyReturn) + correctedContribution;
    }
    const elapsedMonths = year * 12;
    const realBalance = nominal / (1 + monthlyInflation) ** elapsedMonths;
    result.push({
      year: input.initialYear + year,
      annualContribution: correctedContribution * 12,
      nominalBalance: nominal,
      realBalance,
      realMonthlyIncome: realBalance * monthlyReturn
    });
  }

  return result;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

