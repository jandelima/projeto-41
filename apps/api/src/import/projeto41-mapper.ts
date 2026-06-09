import type {
  Contribution,
  Currency,
  ManualPosition,
  Operation
} from "@projeto41/contracts";
import type { PriceRecord } from "@projeto41/db";
import type { FormulaCell, WorkbookCell, WorkbookData } from "./xlsx-reader.js";

export type MappedWorkbook = {
  operations: Operation[];
  positions: ManualPosition[];
  dividends: { asset: string; amount: number }[];
  contributions: Contribution[];
  targets: { category: string; weight: number }[];
  prices: PriceRecord[];
  snapshots: {
    date: string;
    totalBrl: number;
    payload: Record<string, number>;
    priceTimes?: Record<string, string>;
  }[];
  settings: Record<string, string>;
};

export function mapWorkbook(workbook: WorkbookData): MappedWorkbook {
  const now = new Date().toISOString();
  const operations = [
    ...mapOperations(workbook.Operations ?? [], "crypto", "USD"),
    ...mapOperations(workbook["Operações"] ?? [], "b3", "BRL")
  ];
  operations.push(...mapDirectBalances(workbook.Assets ?? [], operations));

  return {
    operations,
    positions: mapManualPositions(workbook),
    dividends: mapDividends(workbook.Ativos ?? []),
    contributions: mapContributions(workbook.Aportes ?? []),
    targets: mapTargets(workbook.MODELO ?? []),
    prices: mapPrices(workbook, now),
    snapshots: mapHistory(workbook.History ?? []),
    settings: mapSettings(workbook.Planning ?? [])
  };
}

function mapDirectBalances(rows: WorkbookCell[][], operations: Operation[]): Operation[] {
  return rows.slice(1).flatMap((row) => {
    const asset = text(row[0]).toUpperCase();
    const sheetQuantity = number(row[1]);
    if (!asset || asset === "TOTAL" || asset === "ALTCOINS" || sheetQuantity <= 0) return [];
    const operationQuantity = operations
      .filter((operation) => operation.portfolio === "crypto" && operation.asset === asset)
      .reduce(
        (total, operation) =>
          total + (operation.type === "buy" ? operation.quantity : -operation.quantity),
        0
      );
    const missingQuantity = sheetQuantity - operationQuantity;
    if (missingQuantity <= 1e-10) return [];
    return [
      {
        portfolio: "crypto",
        type: "buy",
        asset,
        date: "1900-01-01",
        quantity: missingQuantity,
        total: 0,
        currency: "USD",
        notes: "Saldo inicial sem custo informado"
      } satisfies Operation
    ];
  });
}

function mapOperations(
  rows: WorkbookCell[][],
  portfolio: "crypto" | "b3",
  currency: Currency
): Operation[] {
  return rows.slice(1).flatMap((row) => {
    const rawType = text(row[1]).toLowerCase();
    const asset = text(row[2]).toUpperCase();
    const quantity = number(row[3]);
    const total = portfolio === "crypto" ? number(row[4]) : number(row[5]);
    if (!asset || quantity <= 0 || total < 0 || !/(buy|sell|compra|venda)/i.test(rawType)) {
      return [];
    }
    const rawDate = value(row[0]);
    const hasDate = rawDate instanceof Date || typeof rawDate === "number";
    return [
      {
        portfolio,
        type: /sell|venda/i.test(rawType) ? "sell" : "buy",
        asset,
        date: date(rawDate) ?? "1900-01-01",
        quantity,
        total,
        currency,
        notes: hasDate ? undefined : "Data indisponivel na planilha original"
      } satisfies Operation
    ];
  });
}

function mapManualPositions(workbook: WorkbookData): ManualPosition[] {
  const overview = workbook.Overview ?? [];
  const fixa = workbook.Fixa ?? [];
  const dollarParts = formulaNumbers(overview[3]?.[1]).slice(-3);
  const cashParts = formulaNumbers(overview[4]?.[1]).filter((item) => item !== 0).slice(-3);
  const reserveParts = formulaNumbers(overview[18]?.[1]).slice(-2);

  const positions: ManualPosition[] = [
    ...namedParts(
      "dollar",
      ["Binance", "MetaMask", "Autocustodia"],
      dollarParts,
      "USD"
    ),
    ...namedParts(
      "cash",
      ["Caixinha Nubank", "Saldo BTG", "Aupo11"],
      cashParts,
      "BRL"
    ),
    ...namedParts(
      "reserve",
      ["Caixinha Itau", "Caixinha Nubank"],
      reserveParts,
      "BRL"
    )
  ];

  const paper = number(overview[17]?.[1]);
  if (paper || text(overview[17]?.[0])) {
    positions.push({
      category: "reserve",
      name: "Papel-moeda",
      invested: paper,
      currentValue: paper,
      currency: "BRL"
    });
  }

  for (const [rowIndex, name] of [
    [1, "Tesouro Direto BB"],
    [2, "Tesouro Direto BTG"],
    [3, "Outros titulos"]
  ] as const) {
    const invested = number(fixa[rowIndex]?.[1]);
    const currentValue = number(fixa[rowIndex]?.[2]);
    if (invested || currentValue) {
      positions.push({
        category: "fixed_income",
        name,
        invested,
        currentValue,
        currency: "BRL"
      });
    }
  }

  return positions;
}

function namedParts(
  category: ManualPosition["category"],
  names: string[],
  values: number[],
  currency: Currency
) {
  return names.map((name, index) => ({
    category,
    name,
    invested: values[index] ?? 0,
    currentValue: values[index] ?? 0,
    currency
  }));
}

function mapDividends(rows: WorkbookCell[][]) {
  return rows.slice(1).flatMap((row) => {
    const asset = text(row[0]);
    if (!asset || asset === "TOTAL") return [];
    return [{ asset, amount: number(row[6]) }];
  });
}

function mapContributions(rows: WorkbookCell[][]): Contribution[] {
  const starts = [1, 9, 17, 25];
  const result: Contribution[] = [];
  for (let row = 1; row <= 16; row += 1) {
    const week = Math.floor((row - 1) / 4);
    for (let month = 1; month <= 12; month += 1) {
      const amount = number(rows[row]?.[month]);
      if (amount <= 0) continue;
      const day = Math.min(starts[week] ?? 1, new Date(2026, month, 0).getDate());
      result.push({
        date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        amount,
        notes: `Importado da faixa semanal ${week + 1}`
      });
    }
  }
  return result;
}

function mapTargets(rows: WorkbookCell[][]) {
  return rows.slice(1, 8).flatMap((row) => {
    const category = slug(text(row[0]));
    const formula = formulaText(row[1]);
    const match = formula.match(/([0-9.]+)\s*\*/);
    if (!category || !match) return [];
    return [{ category, weight: Number(match[1]) }];
  });
}

function mapPrices(workbook: WorkbookData, fetchedAt: string): PriceRecord[] {
  const result: PriceRecord[] = [];
  for (const row of (workbook["Coin List"] ?? []).slice(1)) {
    const symbol = text(row[1]).toUpperCase();
    const price = number(row[2]);
    if (!symbol || price <= 0) continue;
    result.push({
      symbol: symbol === "USD" ? "USDBRL" : symbol,
      currency: symbol === "USD" ? "BRL" : "USD",
      price,
      provider: symbol === "USD" ? "googlefinance-import" : "crypto-server-import",
      marketTime: null,
      fetchedAt,
      error: null
    });
  }
  for (const row of (workbook.Ativos ?? []).slice(1)) {
    const symbol = text(row[0]).toUpperCase();
    const price = number(row[4]);
    if (!symbol || symbol === "TOTAL" || price <= 0) continue;
    result.push({
      symbol,
      currency: "BRL",
      price,
      provider: "googlefinance-import",
      marketTime: null,
      fetchedAt,
      error: null
    });
  }
  return result;
}

function mapHistory(rows: WorkbookCell[][]) {
  return rows.slice(1).flatMap((row) => {
    const snapshotDate = date(value(row[0]));
    const totalBrl = number(row[8]);
    if (!snapshotDate || totalBrl <= 0) return [];
    return [
      {
        date: snapshotDate,
        totalBrl,
        payload: {
          bitcoin: number(row[1]),
          altcoins: number(row[2]),
          dollar: number(row[3]),
          cash: number(row[4]),
          reserve: number(row[5]),
          b3: number(row[6]),
          fixed_income: number(row[7])
        }
      }
    ];
  });
}

function mapSettings(rows: WorkbookCell[][]) {
  const keys = [
    "initialCapital",
    "monthlyContribution",
    "monthlyReturnPercent",
    "months",
    "annualInflationPercent",
    "initialYear",
    "annualReturn",
    "monthlyInflation"
  ];
  return Object.fromEntries(
    keys.map((key, index) => [key, String(number(rows[index + 1]?.[1]))])
  );
}

function value(cell: WorkbookCell | undefined): unknown {
  if (cell && typeof cell === "object" && !(cell instanceof Date) && "formula" in cell) {
    return (cell as FormulaCell).value;
  }
  return cell;
}

function number(cell: WorkbookCell | undefined) {
  const resolved = value(cell);
  if (typeof resolved === "number" && Number.isFinite(resolved)) return resolved;
  if (typeof resolved === "string") {
    const parsed = Number(resolved.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function text(cell: WorkbookCell | undefined) {
  const resolved = value(cell);
  return typeof resolved === "string" ? resolved.trim() : "";
}

function date(raw: unknown) {
  const parsed =
    raw instanceof Date
      ? raw
      : typeof raw === "number"
        ? new Date(Date.UTC(1899, 11, 30 + raw))
        : typeof raw === "string"
          ? new Date(raw)
          : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function formulaText(cell: WorkbookCell | undefined) {
  return cell && typeof cell === "object" && !(cell instanceof Date) && "formula" in cell
    ? (cell as FormulaCell).formula
    : "";
}

function formulaNumbers(cell: WorkbookCell | undefined) {
  return [...formulaText(cell).matchAll(/(?<![A-Za-z0-9])([0-9]+(?:\.[0-9]+)?)/g)].map(
    (match) => Number(match[1])
  );
}

function slug(label: string) {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}
