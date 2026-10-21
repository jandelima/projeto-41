import { z } from "zod";
import { centsSchema, idSchema, isoDateSchema, monthSchema } from "./ledger.js";

/** Os quatro campos que transformam uma conta em cartao (D04). */
export const cardFieldsSchema = z.object({
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  creditLimitCents: centsSchema.nonnegative().nullable(),
  paymentAccountId: idSchema.nullable()
});

export const statementStatusSchema = z.enum(["open", "closed", "paid", "overdue"]);

/**
 * Escopo de uma alteracao em serie.
 *
 * Mora aqui, e nao dentro do drawer, porque a fase 7 vai reutiliza-lo para
 * lancamentos recorrentes.
 */
export const seriesScopeSchema = z.enum(["one", "forward", "all"]);

export const createInstallmentPlanSchema = z.object({
  accountId: idSchema,
  description: z.string().trim().max(200).optional().nullable(),
  purchaseDate: isoDateSchema,
  totalCents: centsSchema.positive(),
  installmentCount: z.number().int().min(1).max(120),
  placeId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  personId: idSchema.nullable().optional()
});

/** Total e numero de parcelas ficam de fora: sao somente-leitura apos criados (6.3). */
export const updateInstallmentPlanSchema = z.object({
  description: z.string().trim().max(200).optional().nullable(),
  placeId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  personId: idSchema.nullable().optional()
});

export const changePlanAccountSchema = z.object({ accountId: idSchema });

export const setInstallmentAmountSchema = z.object({ amountCents: centsSchema });

export const invoicePaymentSchema = z.object({
  date: isoDateSchema,
  fromAccountId: idSchema.optional(),
  /** Pagamento parcial esta fora de escopo (D12): precisa bater com o total. */
  amountCents: centsSchema.positive()
});

/**
 * Desconto na antecipacao. `value` e centavos em `amount` e centesimos de
 * ponto percentual em `percent` (`1250` = 12,5%), para ficar inteiro como todo
 * o resto do modulo (D19).
 */
export const anticipationDiscountSchema = z.object({
  mode: z.enum(["percent", "amount"]),
  scope: z.enum(["each", "total"]),
  value: z.number().int().positive()
});

export const anticipationSchema = z.object({
  entryIds: z.array(idSchema).min(1),
  targetMonth: monthSchema,
  discount: anticipationDiscountSchema.nullable().optional(),
  /** Data do desconto; padrao e hoje. */
  date: isoDateSchema.optional()
});

export const restoreNaturalSchema = z.object({ entryIds: z.array(idSchema).min(1) });

export const refundSchema = z.object({
  amountCents: centsSchema.positive().optional(),
  date: isoDateSchema,
  description: z.string().trim().max(200).optional().nullable()
});

export type CardFields = z.infer<typeof cardFieldsSchema>;
export type StatementStatus = z.infer<typeof statementStatusSchema>;
export type SeriesScope = z.infer<typeof seriesScopeSchema>;
export type CreateInstallmentPlanInput = z.input<typeof createInstallmentPlanSchema>;
export type UpdateInstallmentPlanInput = z.input<typeof updateInstallmentPlanSchema>;
export type InvoicePaymentInput = z.input<typeof invoicePaymentSchema>;
export type AnticipationInput = z.infer<typeof anticipationSchema>;
export type AnticipationDiscount = z.infer<typeof anticipationDiscountSchema>;
export type RefundInput = z.input<typeof refundSchema>;

/**
 * Resumo do cartao.
 *
 * `currentStatementCents` e `totalOwedCents` sao a regra 6.1 e **jamais podem
 * ser colapsados num numero so**: com parcelas futuras em aberto eles sao
 * diferentes, e e essa diferenca que o usuario precisa ver.
 */
export type CardSummary = {
  id: number;
  name: string;
  color: string;
  institution: string | null;
  personId: number | null;
  personName: string | null;
  closingDay: number;
  dueDay: number;
  creditLimitCents: number | null;
  paymentAccountId: number | null;
  paymentAccountName: string | null;
  currentStatementMonth: string;
  closingDate: string;
  dueDate: string;
  /** Fatura aberta: so o `statement_month` corrente. */
  currentStatementCents: number;
  /** Tudo que se deve, inclusive parcelas futuras. */
  totalOwedCents: number;
  usedCents: number;
  /** `null` quando o cartao nao tem limite cadastrado; negativo quando estoura. */
  availableCents: number | null;
};

export type StatementSummary = {
  month: string;
  closingDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  purchasesCents: number;
  paymentsCents: number;
  totalCents: number;
  entryCount: number;
  status: StatementStatus;
  isFuture: boolean;
};

export type InstallmentPlanRecord = {
  id: number;
  accountId: number;
  accountName: string;
  description: string | null;
  purchaseDate: string;
  totalCents: number;
  installmentCount: number;
  placeId: number | null;
  categoryId: number | null;
  categoryName: string | null;
  paidCount: number;
  remainingCount: number;
  remainingCents: number;
  lastStatementMonth: string | null;
  /** Soma das parcelas, para a UI avisar quando deixar de bater com o total. */
  sumCents: number;
  sumMatchesTotal: boolean;
};

export type AnticipationResult = { entryId: number; previousStatementMonth: string | null }[];
