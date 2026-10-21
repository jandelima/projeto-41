import { z } from "zod";
import { idSchema, isoDateSchema } from "./ledger.js";

export const importSourceSchema = z.enum(["ofx", "csv", "pdf"]);
export const importBatchStatusSchema = z.enum([
  "awaiting_mapping",
  "review",
  "committed",
  "discarded"
]);
export const importRowStatusSchema = z.enum([
  "new",
  "duplicate",
  "ignored",
  "committed",
  "needs_review"
]);
export const matchReasonSchema = z.enum(["external_id", "content_hash", "fuzzy_amount_date"]);
export const ruleStageSchema = z.enum(["pre", "default"]);
export const ruleModeSchema = z.enum(["auto", "ask"]);
export const ruleConditionOpSchema = z.enum([
  "contains",
  "equals",
  "regex",
  "amount_between",
  "account_is"
]);
export const ruleActionKindSchema = z.enum([
  "set_place",
  "set_category",
  "set_description",
  "set_tag",
  "set_person",
  "ignore"
]);

export const accountIdentityKindSchema = z.enum(["bank_account", "document", "pix_key"]);

/**
 * A contraparte extraida do descritor do banco.
 *
 * O arquivo nunca diz quem e o dono da conta, mas quase sempre diz com quem a
 * transacao foi feita. Estes campos sao o que permite reconhecer uma
 * transferencia interna e o que alimenta o mapeamento destinatario -> local.
 */
export const counterpartySchema = z.object({
  name: z.string().nullable(),
  /** So digitos. CPF mascarado pelo banco vem `null`: mascara nao identifica. */
  document: z.string().nullable(),
  bankId: z.string().nullable(),
  branchId: z.string().nullable(),
  accountNumber: z.string().nullable(),
  bankName: z.string().nullable()
});

/** A saida dos leitores de OFX e de CSV: o unico formato que o resto conhece. */
export const parsedTransactionSchema = z.object({
  lineNo: z.number().int().nonnegative(),
  date: isoDateSchema,
  /** `HH:MM`. Quase sempre sintetica; preservada, nunca gravada em `entries`. */
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  amountCents: z.number().int(),
  rawDescription: z.string(),
  externalId: z.string().optional(),
  trnType: z.string().optional(),
  checkNum: z.string().optional(),
  counterparty: counterpartySchema.optional(),
  /**
   * A linha exatamente como veio no arquivo: coluna -> valor no CSV, tag ->
   * valor no OFX. Guardada em `import_rows.raw_json` para auditoria e para
   * reconhecer a mesma linha quando o arquivo voltar.
   */
  source: z.record(z.string(), z.string()).optional(),
  installment: z
    .object({
      number: z.number().int().positive(),
      total: z.number().int().positive(),
      uncertain: z.boolean()
    })
    .optional()
});

export const ofxStatementSchema = z.object({
  /** `bank` vira conta corrente; `credit_card` exige conta de cartao (Task 7). */
  envelope: z.enum(["bank", "credit_card"]),
  currency: z.string(),
  accountId: z.string().nullable(),
  bankId: z.string().nullable(),
  branchId: z.string().nullable(),
  accountType: z.string().nullable(),
  institution: z.string().nullable(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  closingBalanceCents: z.number().int().nullable(),
  transactions: z.array(parsedTransactionSchema)
});

export const csvFieldSchema = z.enum([
  "date",
  "amount",
  "amount_in",
  "amount_out",
  "description",
  "type",
  "document",
  "ignore"
]);

export const columnMappingSchema = z
  .object({
    delimiter: z.string().min(1).max(1),
    encoding: z.enum(["utf-8", "windows-1252"]),
    skipLines: z.number().int().nonnegative().default(0),
    hasHeader: z.boolean().default(true),
    dateFormat: z.enum(["dd/MM/yyyy", "dd/MM/yy", "yyyy-MM-dd"]),
    decimalSeparator: z.enum([",", "."]),
    signConvention: z.enum(["signed", "split_columns", "debit_positive"]),
    /** Indice da coluna -> papel. A chave e o indice porque cabecalho repete. */
    columns: z.record(z.string(), csvFieldSchema)
  })
  .superRefine((mapping, ctx) => {
    const roles = Object.values(mapping.columns);
    const count = (role: string) => roles.filter((value) => value === role).length;
    const missing: string[] = [];
    if (count("date") !== 1) missing.push("exatamente uma coluna de data");
    if (count("description") !== 1) missing.push("exatamente uma coluna de descricao");
    const hasSingle = count("amount") === 1;
    const hasSplit = count("amount_in") === 1 && count("amount_out") === 1;
    if (!hasSingle && !hasSplit) {
      missing.push("uma coluna de valor ou o par entrada/saida");
    }
    if (hasSingle && hasSplit) {
      missing.push("valor unico e par entrada/saida ao mesmo tempo");
    }
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Mapeamento incompleto: falta ${missing.join("; ")}.`
      });
    }
  });

export const importRowSchema = z.object({
  id: idSchema,
  batchId: idSchema,
  lineNo: z.number().int(),
  status: importRowStatusSchema,
  parsed: parsedTransactionSchema,
  suggestedPlaceId: idSchema.nullable(),
  suggestedCategoryId: idSchema.nullable(),
  suggestedKind: z.enum(["expense", "income", "transfer"]).nullable(),
  /** Preenchido quando a contraparte e outra conta do proprio usuario. */
  counterpartyAccountId: idSchema.nullable(),
  duplicateOfEntryId: idSchema.nullable(),
  matchReason: matchReasonSchema.nullable(),
  entryId: idSchema.nullable()
});

export const importBatchSchema = z.object({
  id: idSchema,
  source: importSourceSchema,
  accountId: idSchema,
  fileName: z.string(),
  fileHash: z.string(),
  importedAt: z.string(),
  status: importBatchStatusSchema,
  rowCount: z.number().int(),
  committedCount: z.number().int(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  closingBalanceCents: z.number().int().nullable()
});

/** Destinatario que nenhuma regra conhece: o passo interativo pergunta uma vez. */
export const unmappedPayeeSchema = z.object({
  normalized: z.string(),
  display: z.string(),
  document: z.string().nullable(),
  rowCount: z.number().int().positive(),
  totalCents: z.number().int(),
  suggestedKind: z.enum(["expense", "income"])
});

export const importPreviewSchema = z.object({
  batch: importBatchSchema,
  rows: z.array(importRowSchema),
  unmappedPayees: z.array(unmappedPayeeSchema),
  summary: z.object({
    new: z.number().int(),
    duplicate: z.number().int(),
    ignored: z.number().int(),
    transfer: z.number().int()
  })
});

export const ruleConditionSchema = z.object({
  field: z.enum(["description", "raw_description", "amount_cents", "account_id", "document"]),
  op: ruleConditionOpSchema,
  value: z.string()
});

export const ruleActionSchema = z.object({
  action: ruleActionKindSchema,
  value: z.string().nullable()
});

export const ruleSchema = z.object({
  id: idSchema,
  name: z.string(),
  stage: ruleStageSchema,
  priority: z.number().int(),
  active: z.boolean(),
  mode: ruleModeSchema,
  stopProcessing: z.boolean(),
  conditions: z.array(ruleConditionSchema),
  actions: z.array(ruleActionSchema)
});

/** O que o passo interativo de mapeamento envia ao resolver um destinatario. */
export const ruleDraftSchema = z.object({
  normalized: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  placeId: idSchema.nullable().optional(),
  newPlaceName: z.string().trim().min(1).max(120).nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  mode: ruleModeSchema.default("auto")
});

export const importCommitSchema = z.object({
  rowIds: z.array(idSchema).min(1),
  /** 6.7 exige a saida: gravar mesmo o que foi marcado como duplicata. */
  force: z.boolean().default(false)
});

/** Nunca "aplicar em tudo": recebe a lista exata que ficou marcada (R-08). */
export const ruleApplySchema = z.object({
  entryIds: z.array(idSchema).min(1)
});

export const accountIdentitySchema = z.object({
  id: idSchema,
  accountId: idSchema,
  kind: accountIdentityKindSchema,
  value: z.string(),
  label: z.string().nullable()
});

export const accountIdentityDraftSchema = z.object({
  accountId: idSchema,
  kind: accountIdentityKindSchema,
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().max(120).nullable().optional()
});

export type ImportSource = z.infer<typeof importSourceSchema>;
export type ImportBatchStatus = z.infer<typeof importBatchStatusSchema>;
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;
export type MatchReason = z.infer<typeof matchReasonSchema>;
export type RuleStage = z.infer<typeof ruleStageSchema>;
export type RuleMode = z.infer<typeof ruleModeSchema>;
export type Counterparty = z.infer<typeof counterpartySchema>;
export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;
export type OfxStatement = z.infer<typeof ofxStatementSchema>;
export type CsvField = z.infer<typeof csvFieldSchema>;
export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type ColumnMappingDraft = z.input<typeof columnMappingSchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type UnmappedPayee = z.infer<typeof unmappedPayeeSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleAction = z.infer<typeof ruleActionSchema>;
export type RuleDraft = z.input<typeof ruleDraftSchema>;
export type ImportCommit = z.infer<typeof importCommitSchema>;
export type AccountIdentity = z.infer<typeof accountIdentitySchema>;
export type AccountIdentityDraft = z.input<typeof accountIdentityDraftSchema>;

// Revisao lancamento a lancamento ------------------------------------------

/**
 * O que o usuario decide sobre o destinatario ao confirmar uma linha.
 *
 * - `auto`: as proximas linhas dele entram prontas, sem perguntar.
 * - `ask`: as proximas vem pre-preenchidas, mas sempre passam pelo popup.
 * - `none`: nao grava nada sobre o destinatario.
 * - `ignore`: as proximas linhas dele nem entram na revisao.
 */
export const payeeRememberSchema = z.enum(["none", "auto", "ask", "ignore"]);

/** Corpo da confirmacao de uma linha no popup. */
export const importRowConfirmSchema = z
  .object({
    /** `create` grava um lancamento; `link` liga a linha ao que ja existe; `skip` ignora. */
    action: z.enum(["create", "link", "skip"]),
    kind: z.enum(["expense", "income", "transfer"]).default("expense"),
    /** Na transferencia, a outra conta: o sinal da linha diz quem e origem. */
    toAccountId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    placeName: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    personId: idSchema.nullable().optional(),
    tagIds: z.array(idSchema).default([]),
    /** Lancamento a vincular; ausente usa o que a dedupe apontou. */
    linkEntryId: idSchema.nullable().optional(),
    remember: payeeRememberSchema.default("none")
  })
  .superRefine((value, ctx) => {
    if (value.action === "create" && value.kind === "transfer" && value.toAccountId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toAccountId"],
        message: "Escolha a outra conta da transferencia"
      });
    }
    if (value.kind === "transfer" && value.categoryId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categoryId"],
        message: "Transferencia nao tem categoria"
      });
    }
    if (value.remember === "ignore" && value.action !== "skip") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remember"],
        message: "Ignorar sempre so combina com pular a linha"
      });
    }
  });

export type PayeeRemember = z.infer<typeof payeeRememberSchema>;
export type ImportRowConfirm = z.input<typeof importRowConfirmSchema>;

/**
 * O que o arquivo e: extrato da conta (entradas e saidas do banco) ou fatura
 * do cartao (so compras, positivas no CSV do Nubank). Decide a conta aceita.
 */
export const statementKindSchema = z.enum(["bank", "card"]);
export type StatementKind = z.infer<typeof statementKindSchema>;

/** Quao seguro o sistema esta de que a linha e um lancamento que ja existe. */
export const matchConfidenceSchema = z.enum(["certain", "likely", "possible"]);
export type MatchConfidence = z.infer<typeof matchConfidenceSchema>;

/**
 * Um lancamento do livro que uma linha do arquivo parece repetir, com o que a
 * tela precisa para mostrar os dois lados e o que muda ao vincular.
 */
export type ImportCandidate = {
  entryId: number;
  reason: MatchReason;
  confidence: MatchConfidence;
  /** Dias entre a data do arquivo e a do lancamento. */
  dayDistance: number;
  date: string;
  amountCents: number;
  kind: "expense" | "income" | "transfer" | "adjustment";
  /** Situacao do lancamento: previsto (`pending`), confirmado ou conciliado. */
  status: "pending" | "cleared" | "reconciled";
  description: string | null;
  placeName: string | null;
  categoryName: string | null;
  personName: string | null;
  /** Transferencia: a conta do outro lado. */
  transferWith: string | null;
  /** Parcela de um plano: `Parcela 2/4`. */
  installment: { number: number; total: number } | null;
  reconciled: boolean;
  /** Motivo de nao poder vincular (conciliado, valor diferente em transferencia...). */
  blocked: string | null;
};

/** Linha do lote como a tela de revisao enxerga. */
export type ImportRowView = {
  id: number;
  lineNo: number;
  status: ImportRowStatus;
  date: string;
  /** `HH:MM` quando o arquivo traz (OFX); o CSV do Nubank nao tem hora. */
  time: string | null;
  amountCents: number;
  rawDescription: string;
  paymentMethod: "pix" | "debit" | null;
  /** `Parcela 2/4` da fatura. */
  installment: { number: number; total: number } | null;
  /** So cartao: a fatura (`YYYY-MM` do vencimento) em que a linha cai. */
  statementMonth: string | null;
  payee: {
    /** Chave estavel: `doc:<digitos>`, `name:<normalizado>` ou `raw:<normalizado>`. */
    key: string;
    display: string;
    document: string | null;
  };
  /** O que o popup abre preenchido: regra do destinatario ou deducao do descritor. */
  suggestion: {
    kind: "expense" | "income";
    categoryId: number | null;
    placeName: string | null;
    description: string | null;
    personId: number | null;
  };
  rule: { id: number; mode: RuleMode; ignore: boolean } | null;
  /** O lancamento do livro que a linha parece repetir (o mais provavel), se houver. */
  duplicate: ImportCandidate | null;
  /** Outros lancamentos parecidos, do mais para o menos provavel. */
  alternatives: ImportCandidate[];
  entryId: number | null;
  /** Pulada sozinha: a mesma linha foi pulada (ou teve o lancamento apagado) antes. */
  skippedBefore: boolean;
  /** So linha vinda de PDF: quanto a leitura merece confianca. */
  pdf: {
    /** 0..1, sempre abaixo de 1. */
    confidence: number;
    /** `false`: o texto nao trazia marcador de credito/debito — confira o sinal. */
    signKnown: boolean;
    sourcePage: number | null;
    warnings: string[];
  } | null;
};

/** Um eixo da conciliacao do PDF: o que o documento declara contra a soma lida. */
export type PdfReconciliationAxis = {
  key: string;
  label: string;
  declaredCents: number | null;
  parsedCents: number;
  differenceCents: number | null;
  rowCount: number;
  status: "match" | "mismatch" | "unavailable";
};

export type PdfBatchInfo = {
  adapterId: string;
  layoutVersion: string;
  /** `mismatch` em qualquer eixo (ou eixo indisponivel) bloqueia o caminho automatico. */
  reconciliation: { status: "match" | "mismatch"; axes: PdfReconciliationAxis[] };
  warnings: string[];
};

export type ImportBatchView = {
  batch: ImportBatch & { accountName: string; statementKind: StatementKind; pdf: PdfBatchInfo | null };
  /** Mesmo arquivo ja enviado antes: so aviso, nunca bloqueio. */
  previousImportAt: string | null;
  rows: ImportRowView[];
  counts: {
    review: number;
    ready: number;
    duplicate: number;
    ignored: number;
    committed: number;
  };
};

export type ImportBatchSummary = ImportBatch & {
  accountName: string;
  pendingCount: number;
};
