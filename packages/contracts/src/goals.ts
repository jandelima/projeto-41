import { z } from "zod";
import { centsSchema, colorSchema, idSchema, isoDateSchema } from "./ledger.js";

/**
 * Caixinhas (plano mestre 4.5).
 *
 * Toda caixinha tem conta própria (`kind='goal'`) e fica atrelada a uma conta
 * de dinheiro: guardar é transferência da conta atrelada para a caixinha, e
 * resgatar é o caminho de volta. A marcação (`earmark`) só existiu até a
 * migração 019, que converteu as que havia; nenhuma rota troca o modo depois.
 */
export const goalModeSchema = z.enum(["earmark", "account"]);
export type GoalMode = z.infer<typeof goalModeSchema>;

/**
 * Como o lucro entra na caixinha:
 * - `auto`: o rendimento do CDI é apurado e lançado sozinho (exige o % do CDI);
 * - `manual`: nada entra sozinho; o usuário lança o lucro quando quiser.
 */
export const goalProfitModeSchema = z.enum(["auto", "manual"]);
export type GoalProfitMode = z.infer<typeof goalProfitModeSchema>;

const goalBase = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
  icon: z.string().trim().max(40).nullable().optional(),
  targetAmountCents: centsSchema.positive().nullable().optional(),
  targetDate: isoDateSchema.nullable().optional(),
  /**
   * Percentual do CDI. Na marcação, o rendimento é creditado na conta marcada
   * e fica separado na própria caixinha.
   */
  cdiPercent: z.number().min(1).max(300).nullable().optional(),
  /**
   * Ausente: `auto` se há % do CDI, senão `manual`. Automático sem % do CDI
   * não tem de onde tirar o rendimento e é recusado.
   */
  profitMode: goalProfitModeSchema.optional()
});

const profitModeNeedsCdi = (
  value: { profitMode?: GoalProfitMode; cdiPercent?: number | null },
  ctx: z.RefinementCtx
) => {
  if (value.profitMode === "auto" && value.cdiPercent == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cdiPercent"],
      message: "Lucro automático precisa do percentual do CDI"
    });
  }
};

export const goalCreateSchema = goalBase
  .extend({
    /**
     * Caixinha nova sempre tem conta própria: a marcação não é mais oferecida.
     * O campo continua para os testes e dados antigos do repositório.
     */
    mode: goalModeSchema.default("account"),
    /** Só no modo marcação: a conta cujo saldo a caixinha marca. */
    accountId: idSchema.nullable().optional(),
    /**
     * A conta a que a caixinha está atrelada: guardar tira dela, resgatar
     * devolve para ela. Obrigatória em caixinha com conta própria.
     */
    parentAccountId: idSchema.nullable().optional(),
    /** Só no modo conta: dono da conta criada junto. Sem ele, o da conta atrelada. */
    personId: idSchema.nullable().optional()
  })
  .superRefine((value, ctx) => {
    profitModeNeedsCdi(value, ctx);
    if (value.mode === "earmark" && value.accountId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountId"],
        message: "Marcacao precisa da conta que ela marca"
      });
    }
    if (value.mode === "account" && value.parentAccountId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentAccountId"],
        message: "Escolha a conta a que a caixinha fica atrelada"
      });
    }
  });

/**
 * **Sem o campo `mode`.** O modo é imutável por contrato, por repositório e por
 * `CHECK` de esquema — três camadas.
 */
export const goalUpdateSchema = goalBase
  .extend({
    /** Trocar a conta atrelada vale para os próximos movimentos; ausente mantém a atual. */
    parentAccountId: idSchema.optional()
  })
  .superRefine(profitModeNeedsCdi);

export const goalDepositSchema = z.object({
  amountCents: centsSchema.positive(),
  date: isoDateSchema,
  /** Ausente: a conta atrelada. */
  fromAccountId: idSchema.optional(),
  description: z.string().trim().max(200).nullable().optional()
});

export const goalWithdrawalSchema = z.object({
  amountCents: centsSchema.positive(),
  date: isoDateSchema,
  /** Ausente: a conta atrelada. */
  toAccountId: idSchema.optional(),
  description: z.string().trim().max(200).nullable().optional()
});

/**
 * Lucro lançado pelo usuário, quando quiser: entra no saldo da caixinha como
 * lucro e não como dinheiro que ele pôs.
 */
export const goalProfitSchema = z.object({
  amountCents: centsSchema.positive(),
  date: isoDateSchema,
  description: z.string().trim().max(200).nullable().optional()
});

/**
 * "O lucro desta caixinha, no total, é X": o sistema lança a diferença como
 * ajuste de lucro (para mais ou para menos). Serve para acertar com o banco.
 */
export const goalProfitAdjustSchema = z.object({
  totalCents: z.number().int(),
  /** Ausente: hoje. */
  date: isoDateSchema.optional()
});

export const goalAllocationSchema = z.object({
  entryId: idSchema,
  amountCents: centsSchema.positive()
});

/** Separa (positivo) ou libera (negativo) parte do saldo numa marcação. */
export const goalMarkSchema = z.object({
  amountCents: centsSchema.refine((value) => value !== 0, "Informe um valor")
});

export const goalAccrueSchema = z.object({ through: isoDateSchema.optional() });

/** "O saldo real era X no fim do dia D": o sistema recalcula dali em diante. */
export const goalCorrectionSchema = z.object({
  date: isoDateSchema,
  valueCents: z.number().int().nonnegative()
});

export type GoalCreateInput = z.input<typeof goalCreateSchema>;
export type GoalUpdateInput = z.input<typeof goalUpdateSchema>;
export type GoalDepositInput = z.infer<typeof goalDepositSchema>;
export type GoalWithdrawalInput = z.infer<typeof goalWithdrawalSchema>;
export type GoalProfitInput = z.infer<typeof goalProfitSchema>;
export type GoalProfitAdjustInput = z.infer<typeof goalProfitAdjustSchema>;

export type GoalRecord = {
  id: number;
  name: string;
  mode: GoalMode;
  accountId: number | null;
  accountName: string | null;
  /** Conta atrelada: de onde sai o que se guarda e para onde volta o resgate. */
  parentAccountId: number | null;
  parentAccountName: string | null;
  targetAmountCents: number | null;
  targetDate: string | null;
  cdiPercent: number | null;
  /** Como o lucro entra: sozinho (CDI) ou lançado pelo usuário. */
  profitMode: GoalProfitMode;
  color: string;
  icon: string | null;
  archived: boolean;
  createdAt: string;
};

/**
 * Quanto a caixinha lucrou, e a que ritmo.
 *
 * `percent` é o lucro sobre o dinheiro que esteve parado (não sobre o saldo, que
 * já inclui o lucro). `annualPercent` repete esse ritmo por um ano em juros
 * compostos: com poucos dias de histórico (`shortHistory`) é só indicativo.
 */
export type GoalProfit = {
  /** Lucro total no saldo: rendimento + lucro lançado + ajustes + correções. */
  cents: number;
  /** Quanto você pôs na caixinha, sem contar saques. */
  depositedCents: number;
  /** Dinheiro parado em média no período. */
  averageCapitalCents: number;
  /** Dias do primeiro aporte até hoje (ou até o resgate total). */
  days: number;
  percent: number | null;
  annualPercent: number | null;
  shortHistory: boolean;
};

/**
 * Progresso consolidado.
 *
 * Rendimento **realizado e projetado são campos distintos**, nunca um só: se
 * existisse um campo único, alguém somaria projeção com realizado na primeira
 * refatoração.
 */
export type GoalProgress = GoalRecord & {
  /** Saldo calculado: o que você colocou + o que rendeu + as correções. */
  balanceCents: number;
  /** Depósitos menos saques: o dinheiro que você pôs. */
  contributedCents: number;
  /** Rendimento já no saldo (lançado na conta própria ou separado na marcação). */
  yieldCents: number;
  /** Soma das correções de saldo informadas por você. */
  correctionCents: number;
  targetRatioPerMille: number | null;
  remainingCents: number | null;
  daysToTarget: number | null;
  realizedYieldCents: number;
  realizedThroughDate: string | null;
  projectedYieldCents: number;
  projectedThroughDate: string | null;
  /** Resgate hipotético hoje, já com IOF e IR (D15). */
  grossCents: number;
  iofCents: number;
  irCents: number;
  netCents: number;
  /** Dia em que o IOF do aporte mais novo zera, ou `null` se já passou. */
  iofFreeFrom: string | null;
  projection: {
    monthlyDepositCents: number;
    estimatedDate: string | null;
    basis: "deposits" | "deposits+yield" | "none";
  };
  /** Lucro em reais, em % até agora e em % ao ano projetado. */
  profit: GoalProfit;
};

export type CdiStatus = {
  lastDate: string | null;
  rowCount: number;
  lastFetchAt: string | null;
  seededThrough: string | null;
  online: boolean;
  staleDays: number | null;
};
