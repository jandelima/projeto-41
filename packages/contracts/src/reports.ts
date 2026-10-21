import { z } from "zod";
import { categoryKindSchema, centsSchema, isoDateSchema } from "./ledger.js";

// Enums e primitivos ---------------------------------------------------------

export const splitModeSchema = z.enum(["none", "income_proportional", "pooled"]);
export type SplitMode = z.infer<typeof splitModeSchema>;

/** Periodo de relatorio, `YYYY-MM`. Distinto de `isoDateSchema`, que e o dia. */
export const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periodo precisa ser YYYY-MM");

export const yearSchema = z.coerce.number().int().min(1970).max(2200);

/**
 * Intervalo do relatorio. Exatamente um dos tres deve vir: `from`+`to`,
 * `period` ou `year`. Escolher por precedencia silenciosa esconde o erro de
 * quem chamou.
 */
export const reportRangeSchema = z
  .object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    period: periodSchema.optional(),
    year: yearSchema.optional()
  })
  .superRefine((value, ctx) => {
    const hasRange = value.from != null || value.to != null;
    const chosen = [hasRange, value.period != null, value.year != null].filter(Boolean).length;
    if (chosen === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe from/to, period ou year"
      });
      return;
    }
    if (chosen > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe apenas um entre from/to, period e year"
      });
      return;
    }
    if (hasRange) {
      if (value.from == null || value.to == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Informe from e to juntos"
        });
      } else if (value.to < value.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["to"],
          message: "Data final anterior a inicial"
        });
      }
    }
  });

export type ReportRange = z.infer<typeof reportRangeSchema>;

export const categoryReportQuerySchema = z.intersection(
  reportRangeSchema,
  z.object({
    kind: categoryKindSchema.default("expense"),
    compare: z
      .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
      .transform((value) => value === true || value === "true" || value === "1")
      .default(true)
  })
);

export const categoryTrendQuerySchema = z.object({
  categoryId: z
    .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
    .transform((value) => {
      const parts = Array.isArray(value) ? value : String(value).split(",");
      return parts.map((part) => Number(String(part).trim())).filter(Number.isInteger);
    })
    .optional(),
  months: z.coerce.number().int().min(1).max(60).default(12),
  endMonth: periodSchema.optional()
});

// Mutacoes -------------------------------------------------------------------

/**
 * `null` e o gesto de **limpar** e precisa ser distinguivel de ausente, que
 * preserva. Por isso `.nullable().optional()` e nao um `.default()`.
 */
export const budgetPeriodInputSchema = z.object({
  splitMode: splitModeSchema,
  totalExpenseTargetCents: centsSchema.nonnegative().nullable().optional(),
  pooledIncomeCents: centsSchema.nonnegative().nullable().optional(),
  jointExpenseTargetCents: centsSchema.nonnegative().nullable().optional()
});

export const personPeriodBudgetInputSchema = z.object({
  incomeOverrideCents: centsSchema.nullable().optional(),
  targetOverrideCents: centsSchema.nullable().optional()
});

export type BudgetPeriodInput = z.infer<typeof budgetPeriodInputSchema>;
export type PersonPeriodBudgetInput = z.infer<typeof personPeriodBudgetInputSchema>;

export const entryTargetFlagSchema = z.object({ countsTowardTarget: z.boolean() });

// Respostas ------------------------------------------------------------------

export type CategoryReportRow = {
  categoryId: number | null;
  name: string;
  color: string | null;
  spentCents: number;
  /** O objetivo ja em centavos para o periodo, venha ele de valor ou de percentual. */
  budgetCents: number | null;
  budgetMode: "absolute" | "share" | null;
  /** Presente so no modo percentual: o objetivo como fracao das saidas. */
  budgetSharePerMille: number | null;
  overBudget: boolean;
  sharePerMille: number;
};

export type DonutSlice = {
  categoryId: number | null;
  name: string;
  color: string | null;
  valueCents: number;
  sharePerMille: number;
};

export type CategoryComparison = {
  categoryId: number | null;
  name: string;
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  variationRatio: number | null;
  label: string;
  tone: "positive" | "negative" | "neutral";
};

export type CategoryReport = {
  range: { from: string; to: string };
  kind: "income" | "expense";
  rows: CategoryReportRow[];
  slices: DonutSlice[];
  totalCents: number;
  budgetTotalCents: number | null;
  comparison: {
    previousRange: { from: string; to: string };
    /** Total do periodo anterior inteiro. */
    previousCents: number;
    /** Truncado no mesmo dia do mes, quando o atual e parcial. */
    previousToDateCents: number | null;
    partial: boolean;
    daysElapsed: number;
    daysInPeriod: number;
    rows: CategoryComparison[];
  } | null;
};

export type CategoryTrend = {
  categoryId: number | null;
  name: string;
  color: string | null;
  points: { month: string; totalCents: number }[];
};

export type LedgerSummary = {
  period: string;
  /** Saldo e fatura, lado a lado e nunca somados: um e dinheiro, o outro divida. */
  /** `currentCents` e o saldo das contas do patrimonio, caixinhas incluidas. */
  consolidated: { currentCents: number; cardStatementCents: number };
  accounts: {
    id: number;
    name: string;
    color: string;
    kind: string;
    personId: number | null;
    personName: string | null;
    /** Saldo da conta, inteiro: o que o banco mostra, caixinhas incluidas. */
    currentBalanceCents: number;
    /** Guardado nas caixinhas atreladas a esta conta: fora do saldo dela. */
    goalsCents: number;
    /** Conta que paga a fatura, para o Painel mostrar o cartao junto dela. */
    paymentAccountId: number | null;
    /**
     * So cartao: a fatura corrente, no ciclo do proprio cartao. Valor positivo
     * e divida. `null` quando o cartao nao tem fechamento e vencimento.
     */
    statement: { amountCents: number; closingDate: string; dueDate: string } | null;
    /** Entradas, saidas e liquido da conta no periodo pedido, mesma regra de `month`. */
    flows: { incomeCents: number; expenseCents: number; netCents: number };
  }[];
  month: { incomeCents: number; expenseCents: number; netCents: number };
  previousMonth: { incomeCents: number; expenseCents: number; netCents: number };
};

export type TargetBarResponse = {
  personId: number | null;
  name: string;
  color: string;
  targetCents: number | null;
  realizedCents: number;
  ratioPerMille: number | null;
  over: boolean;
};

export type TargetReport = {
  period: string;
  splitMode: SplitMode;
  totalExpenseTargetCents: number | null;
  pooledIncomeCents: number | null;
  jointExpenseTargetCents: number | null;
  totalTargetCents: number | null;
  /** Renda apurada por pessoa, para a tela mostrar o que esta sobrescrevendo. */
  people: {
    id: number;
    name: string;
    color: string;
    kind: "individual" | "joint";
    incomeCents: number;
    incomeOverrideCents: number | null;
    targetOverrideCents: number | null;
  }[];
  bars: TargetBarResponse[];
  warnings: string[];
};
