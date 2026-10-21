import { z } from "zod";

export const portfolioSchema = z.enum(["crypto", "b3"]);
export const operationTypeSchema = z.enum(["buy", "sell"]);
export const currencySchema = z.enum(["BRL", "USD"]);

export const operationSchema = z.object({
  id: z.number().int().positive().optional(),
  portfolio: portfolioSchema,
  type: operationTypeSchema,
  asset: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  date: z.string().date(),
  quantity: z.number().positive(),
  total: z.number().nonnegative(),
  currency: currencySchema,
  notes: z.string().trim().optional(),
  /** Conta do livro que paga a compra ou recebe a venda (fase 4). */
  accountId: z.number().int().positive().nullable().optional(),
  /**
   * Caixa (posição de "Caixa e renda fixa") que paga a compra ou recebe a
   * venda. Exclusivo com `accountId`: o dinheiro vem de um lugar só.
   */
  positionId: z.number().int().positive().nullable().optional()
});

export const manualPositionSchema = z.object({
  id: z.number().int().positive().optional(),
  // `crypto` é caixa em cripto (stablecoin na corretora, à espera de compra).
  category: z.enum(["dollar", "cash", "reserve", "crypto", "fixed_income", "global"]),
  name: z.string().trim().min(1),
  invested: z.number().nonnegative().default(0),
  currentValue: z.number().nonnegative(),
  currency: currencySchema.default("BRL"),
  notes: z.string().trim().optional(),
  /** Percentual do CDI que a posição rende. `null` ou ausente: não rende. */
  cdiPercent: z.number().positive().max(1000).nullable().optional(),
  /** Dia a partir do qual o valor atual rende. */
  cdiSince: z.string().date().nullable().optional()
});

export const contributionSchema = z.object({
  id: z.number().int().positive().optional(),
  date: z.string().date(),
  amount: z.number().nonnegative(),
  notes: z.string().trim().optional()
});

/** Conta do módulo de investimentos: uma por pessoa do módulo de finanças. */
export type InvestmentAccount = {
  id: number;
  name: string;
  personId: number | null;
  sortOrder: number;
};

export type Operation = z.infer<typeof operationSchema>;
export type ManualPosition = z.infer<typeof manualPositionSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type Currency = z.infer<typeof currencySchema>;


export * from "./ledger.js";
export * from "./views.js";
export * from "./reports.js";
export * from "./cards.js";
export * from "./goals.js";
export * from "./import.js";
