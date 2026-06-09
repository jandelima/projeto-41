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
  notes: z.string().trim().optional()
});

export const manualPositionSchema = z.object({
  id: z.number().int().positive().optional(),
  category: z.enum(["dollar", "cash", "reserve", "fixed_income", "global"]),
  name: z.string().trim().min(1),
  invested: z.number().nonnegative().default(0),
  currentValue: z.number().nonnegative(),
  currency: currencySchema.default("BRL"),
  notes: z.string().trim().optional()
});

export const contributionSchema = z.object({
  id: z.number().int().positive().optional(),
  date: z.string().date(),
  amount: z.number().nonnegative(),
  notes: z.string().trim().optional()
});

export type Operation = z.infer<typeof operationSchema>;
export type ManualPosition = z.infer<typeof manualPositionSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Portfolio = z.infer<typeof portfolioSchema>;
export type Currency = z.infer<typeof currencySchema>;

