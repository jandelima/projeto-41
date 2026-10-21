import { z } from "zod";

// Enums ---------------------------------------------------------------------

export const personKindSchema = z.enum(["individual", "joint"]);
export const accountKindSchema = z.enum([
  "checking",
  "cash",
  "meal_voucher",
  "credit_card",
  "investment",
  "goal"
]);
export const categoryKindSchema = z.enum(["income", "expense"]);
export const entryKindSchema = z.enum(["expense", "income", "transfer", "adjustment"]);
export const entryStatusSchema = z.enum(["pending", "cleared", "reconciled"]);
/** Pix e débito são dinheiro (migração 011): só à vista contra crédito importa. */
export const paymentMethodSchema = z.enum(["cash", "credit", "voucher", "other"]);
export const transferPurposeSchema = z.enum([
  "generic",
  "invoice_payment",
  "investment",
  "goal_deposit",
  "goal_withdrawal",
  "settlement"
]);

export type PersonKind = z.infer<typeof personKindSchema>;
export type AccountKind = z.infer<typeof accountKindSchema>;
export type CategoryKind = z.infer<typeof categoryKindSchema>;
export type EntryKind = z.infer<typeof entryKindSchema>;
export type EntryStatus = z.infer<typeof entryStatusSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type TransferPurpose = z.infer<typeof transferPurposeSchema>;

// Primitivos ----------------------------------------------------------------

/** Cor em hex de 6 digitos, que e o formato do input nativo de cor. */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor precisa ser hex #rrggbb");
export const isoDateSchema = z.string().date();
/** Mes de fatura, no formato YYYY-MM (plano mestre 6.2). */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes precisa ser YYYY-MM");
/** Dinheiro e sempre centavos inteiros (D19), nunca z.number() solto. */
// Até R$ 1 trilhão: valor maior é erro de digitação e perderia precisão no REAL.
export const centsSchema = z.number().int().min(-100_000_000_000_000).max(100_000_000_000_000);
export const idSchema = z.number().int().positive();

const optionalText = z.string().trim().max(500).optional().nullable();

// Cadastros -----------------------------------------------------------------

export const personSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(60),
  kind: personKindSchema.default("individual"),
  color: colorSchema,
  active: z.boolean().default(true)
});

export const accountSchema = z
  .object({
    id: idSchema.optional(),
    personId: idSchema.nullable().optional(),
    name: z.string().trim().min(1).max(80),
    kind: accountKindSchema,
    institution: optionalText,
    color: colorSchema,
    icon: optionalText,
    openingBalanceCents: centsSchema.default(0),
    openingDate: isoDateSchema.nullable().optional(),
    closingDay: z.number().int().min(1).max(31).nullable().optional(),
    dueDay: z.number().int().min(1).max(31).nullable().optional(),
    creditLimitCents: centsSchema.nonnegative().nullable().optional(),
    paymentAccountId: idSchema.nullable().optional(),
    includeInNetWorth: z.boolean().default(true),
    archived: z.boolean().default(false),
    sortOrder: z.number().int().default(0)
  })
  .superRefine((value, ctx) => {
    // Sem ciclo e sem vencimento, a fatura do app nunca bate com a do banco (D04).
    if (value.kind === "credit_card") {
      if (value.closingDay == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["closingDay"],
          message: "Cartao precisa de dia de fechamento"
        });
      }
      if (value.dueDay == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueDay"],
          message: "Cartao precisa de dia de vencimento"
        });
      }
    }
    if (value.paymentAccountId != null && value.paymentAccountId === value.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentAccountId"],
        message: "Conta de pagamento nao pode ser o proprio cartao"
      });
    }
  });

export const categorySchema = z
  .object({
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(60),
    kind: categoryKindSchema,
    color: colorSchema,
    icon: optionalText,
    /** Objetivo em valor: quanto a categoria pode gastar por mes. */
    monthlyBudgetCents: centsSchema.nonnegative().nullable().optional(),
    /**
     * Objetivo em percentual, em milesimos do total de saidas do periodo:
     * `250` e "Mercado deve ser 25% dos gastos". Exclusivo com o de valor.
     */
    budgetSharePerMille: z.number().int().min(0).max(1000).nullable().optional(),
    archived: z.boolean().default(false),
    sortOrder: z.number().int().default(0)
  })
  .superRefine((value, ctx) => {
    if (value.monthlyBudgetCents != null && value.budgetSharePerMille != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["budgetSharePerMille"],
        message: "O objetivo e em valor ou em percentual, nao os dois"
      });
    }
  });

export const tagSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(40),
  color: colorSchema
});

export const placeSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(120),
  defaultCategoryId: idSchema.nullable().optional(),
  notes: optionalText
});

// Lancamentos ---------------------------------------------------------------

const entryBase = z.object({
  id: idSchema.optional(),
  accountId: idSchema,
  personId: idSchema.nullable().optional(),
  date: isoDateSchema,
  amountCents: centsSchema,
  kind: entryKindSchema,
  status: entryStatusSchema.default("cleared"),
  categoryId: idSchema.nullable().optional(),
  placeId: idSchema.nullable().optional(),
  description: optionalText,
  notes: optionalText,
  paymentMethod: paymentMethodSchema.nullable().optional(),
  statementMonth: monthSchema.nullable().optional(),
  refundOfEntryId: idSchema.nullable().optional(),
  /**
   * Ausente significa "derive pela regra 6.4"; presente e a excecao manual
   * caso a caso. Por isso nao tem `.default()`: um padrao apagaria a diferenca
   * entre "o usuario nao disse" e "o usuario marcou".
   */
  countsTowardTarget: z.boolean().optional(),
  tagIds: z.array(idSchema).default([])
});

/**
 * Regras que o CHECK do SQLite nao alcanca.
 *
 * O sinal segue o tipo (saida negativa, entrada positiva), com uma excecao:
 * estorno. Um estorno de despesa e kind='expense' com valor positivo, e e assim
 * que ele abate a categoria em vez de virar receita (plano mestre 6.6).
 */
export const entrySchema = entryBase.superRefine((value, ctx) => {
  if (value.amountCents === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountCents"],
      message: "Valor nao pode ser zero"
    });
  }
  if (value.kind === "transfer" && value.categoryId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["categoryId"],
      message: "Transferencia nao tem categoria"
    });
  }
  const isRefund = value.refundOfEntryId != null;
  if (!isRefund && value.kind === "expense" && value.amountCents > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountCents"],
      message: "Saida precisa ser negativa"
    });
  }
  if (!isRefund && value.kind === "income" && value.amountCents < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountCents"],
      message: "Entrada precisa ser positiva"
    });
  }
});

/** Cria as duas pontas de uma transferencia de uma vez (D20). */
export const transferSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    date: isoDateSchema,
    /** Sempre positivo: o sinal de cada ponta e responsabilidade do repositorio. */
    amountCents: centsSchema.positive(),
    purpose: transferPurposeSchema.default("generic"),
    status: entryStatusSchema.default("cleared"),
    description: optionalText,
    notes: optionalText,
    personId: idSchema.nullable().optional(),
    /** Quando a ponta de destino cai numa fatura de cartao. */
    statementMonth: monthSchema.nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.fromAccountId === value.toAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toAccountId"],
        message: "Conta de origem e destino precisam ser diferentes"
      });
    }
  });

// Filtros -------------------------------------------------------------------

/** Aceita a mesma chave repetida na query string e tambem a forma "1,2". */
const idListSchema = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .transform((value) => {
    const parts = Array.isArray(value) ? value : String(value).split(",");
    return parts
      .map((part) => Number(String(part).trim()))
      .filter((part) => Number.isInteger(part) && part > 0);
  })
  .pipe(z.array(idSchema))
  .optional();

const boolishSchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1")
  .optional();

export const entryFilterSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  kind: entryKindSchema.optional(),
  accountId: z.coerce.number().int().positive().optional(),
  personId: z.coerce.number().int().positive().optional(),
  categoryId: idListSchema,
  tagId: idListSchema,
  placeId: z.coerce.number().int().positive().optional(),
  status: entryStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  minCents: z.coerce.number().int().optional(),
  maxCents: z.coerce.number().int().optional(),
  statementMonth: monthSchema.optional(),
  installmentPlanId: z.coerce.number().int().positive().optional(),
  /** Movimentos de uma caixinha, nos dois modos (fase 5). */
  goalId: z.coerce.number().int().positive().optional(),
  /** Transferencias poluem o extrato de gastos; a UI liga e desliga. */
  includeTransfers: boolishSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50)
});

// Tipos de leitura ----------------------------------------------------------

/**
 * Os tipos `*Draft` sao o **input** dos schemas: os campos com `.default()`
 * ainda sao opcionais neles. Sao eles que os repositorios recebem, porque cada
 * repositorio ja aplica seu proprio padrao ao gravar — exigir o tipo de saida
 * obrigaria todo chamador a repetir defaults que o banco ja tem.
 */
export type PersonDraft = z.input<typeof personSchema>;
export type AccountDraft = z.input<typeof accountSchema>;
export type CategoryDraft = z.input<typeof categorySchema>;
export type TagDraft = z.input<typeof tagSchema>;
export type PlaceDraft = z.input<typeof placeSchema>;
export type EntryDraft = z.input<typeof entrySchema>;
export type TransferDraft = z.input<typeof transferSchema>;

export type Person = z.infer<typeof personSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Place = z.infer<typeof placeSchema>;
export type EntryInput = z.infer<typeof entrySchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type EntryFilter = z.infer<typeof entryFilterSchema>;

export type PersonRecord = Person & { id: number };
export type CategoryRecord = Category & { id: number };
export type TagRecord = Tag & { id: number };
export type PlaceRecord = Place & { id: number; normalizedName: string };

/** O que accounts.list devolve: cadastro mais os saldos derivados (D24). */
export type AccountRecord = Account & {
  id: number;
  personName: string | null;
  currentBalanceCents: number;
  /** So cartao: fatura do mes corrente e total devido (plano mestre 6.1). */
  currentStatementCents?: number;
  totalDueCents?: number;
  availableLimitCents?: number | null;
};

export type AttachmentRecord = {
  id: number;
  entryId: number;
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  createdAt: string;
};

/** Uma linha do livro, ja com os rotulos que a tabela mostra. */
export type EntryRecord = {
  id: number;
  accountId: number;
  accountName: string;
  accountKind: AccountKind;
  personId: number | null;
  personName: string | null;
  personColor: string | null;
  date: string;
  amountCents: number;
  kind: EntryKind;
  status: EntryStatus;
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  placeId: number | null;
  placeName: string | null;
  description: string | null;
  notes: string | null;
  rawDescription: string | null;
  paymentMethod: PaymentMethod | null;
  statementMonth: string | null;
  installmentPlanId: number | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  refundOfEntryId: number | null;
  countsTowardTarget: boolean;
  transferId: number | null;
  transferPurpose: TransferPurpose | null;
  /** Caixinha do movimento, resolvida pelo servidor (fase 5). */
  goalId: number | null;
  goalName: string | null;
  goalColor: string | null;
  counterpartAccountId: number | null;
  counterpartAccountName: string | null;
  tags: TagRecord[];
  attachments: AttachmentRecord[];
  createdAt: string;
  updatedAt: string;
};

export type EntryListResult = {
  rows: EntryRecord[];
  total: number;
  page: number;
  pageSize: number;
  totals: { incomeCents: number; expenseCents: number; netCents: number };
};

export type BalancesResult = {
  accounts: AccountRecord[];
  consolidatedCents: number;
  /** Soma das faturas correntes dos cartoes, cada uma no ciclo do proprio cartao. */
  creditCardStatementCents: number;
  creditCardDueCents: number;
};
