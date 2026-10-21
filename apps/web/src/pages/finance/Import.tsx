import { CreditCard, FileUp, Landmark, ListChecks, RotateCcw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ImportBatchSummary,
  ImportBatchView,
  ImportRowConfirm,
  ImportRowStatus,
  ImportRowView,
  StatementKind
} from "@projeto41/contracts";
import { useConfirm } from "../../components/dialog.js";
import { Dropdown } from "../../components/forms.js";
import { ImportRowDialog } from "../../components/finance/ImportRowDialog.js";
import { PdfPasswordDialog } from "../../components/finance/PdfPasswordDialog.js";
import { PdfReconciliationBanner } from "../../components/finance/PdfReconciliationBanner.js";
import { Button, Empty, Field, Loading, Panel, SectionHeading, Tag } from "../../components/ui.js";
import { candidateTitle } from "../../components/finance/ImportCompare.js";
import { ledgerDate, signedMoneyFromCents } from "../../lib/format.js";
import { ACCOUNT_KIND_LABEL, useLedgerReference } from "../../lib/ledger.js";
import { importApi, ImportUploadError } from "../../lib/ledger-import.js";
import { useToast } from "../../lib/toast.js";
import { FilePicker } from "../../components/FilePicker.js";

const STATUS: Record<ImportRowStatus, { label: string; tone: string }> = {
  needs_review: { label: "A revisar", tone: "warning" },
  new: { label: "Pronto (automático)", tone: "info" },
  duplicate: { label: "Já importado", tone: "neutral" },
  ignored: { label: "Pulado", tone: "neutral" },
  committed: { label: "Importado", tone: "positive" }
};

/** Linha de PDF abaixo disto ganha o indicador de leitura duvidosa. */
const LOW_CONFIDENCE = 0.8;

/** Linha de PDF que pede olho: sinal sem marcador, leitura duvidosa ou aviso do leitor. */
function needsAttention(row: ImportRowView): boolean {
  return row.pdf != null && (!row.pdf.signKnown || row.pdf.confidence < LOW_CONFIDENCE || row.pdf.warnings.length > 0);
}

/**
 * A fila da revisão: o que parece já estar no livro vem primeiro, porque é onde
 * um "sim" automático duplicaria dinheiro; depois, no PDF, as linhas duvidosas —
 * ninguém revisa 200 linhas procurando as 6 que importam. O resto segue a
 * ordem do arquivo.
 */
function reviewOrder(a: ImportRowView, b: ImportRowView): number {
  return (
    Number(b.duplicate != null) - Number(a.duplicate != null) ||
    Number(needsAttention(b)) - Number(needsAttention(a)) ||
    a.lineNo - b.lineNo
  );
}

const needsReview = (rows: ImportRowView[]) =>
  rows.filter((row) => row.status === "needs_review").sort(reviewOrder);

const KIND_CHOICES: { value: StatementKind; title: string; text: string; icon: typeof Landmark }[] = [
  {
    value: "bank",
    title: "Extrato da conta",
    text: "Entradas e saídas de uma conta corrente: Pix, débito, transferências.",
    icon: Landmark
  },
  {
    value: "card",
    title: "Fatura do cartão",
    text: "As compras de uma fatura de cartão de crédito, com as parcelas.",
    icon: CreditCard
  }
];

/** Contas que recebem extrato; a fatura vai sempre para um cartão. */
const BANK_KINDS = new Set(["checking", "savings", "cash", "meal_voucher"]);

const HELP: Record<StatementKind, React.ReactNode> = {
  bank: (
    <>
      No app do Nubank: <strong>Extrato → ícone de exportar → CSV</strong>. O arquivo tem as
      colunas Data, Valor, Identificador e Descrição. O identificador de cada transação evita
      importar a mesma linha duas vezes. Extrato em Excel (.xls ou .xlsx), como o do BTG, também
      serve: o cabeçalho do relatório e as linhas de saldo do dia são ignorados. O PDF do extrato
      do BTG também é lido, mas é o caminho de reserva: prefira Excel, CSV ou OFX quando o banco
      oferecer, e confira a soma que aparece no topo da revisão.
    </>
  ),
  card: (
    <>
      No app do Nubank: <strong>Cartão → Faturas → escolha a fatura → exportar CSV</strong>. O
      arquivo tem as colunas date, title e amount, com a compra em valor positivo. Parcelas
      (&quot;Parcela 2/4&quot;) contam como o mesmo estabelecimento, e &quot;Pagamento recebido&quot; é
      pulado: o pagamento da fatura já sai da conta pela tela Fatura.
    </>
  )
};

/**
 * Importação de extrato: sobe o arquivo e revisa lançamento por lançamento.
 *
 * Nada vai para o livro sem passar pelo popup ou por uma regra "sempre
 * automático" que o próprio usuário criou num popup anterior.
 */
export function ImportPage() {
  const reference = useLedgerReference();
  const toast = useToast();
  const confirm = useConfirm();

  // Sem padrão: arquivo de fatura lido como extrato (ou o contrário) grava o
  // dinheiro no lugar errado, então o usuário escolhe antes de qualquer coisa.
  const [kind, setKind] = useState<StatementKind | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [view, setView] = useState<ImportBatchView | null>(null);
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** PDF com senha: o diálogo fica aberto até acertar ou desistir. */
  const [passwordPrompt, setPasswordPrompt] = useState<{ incorrect: boolean } | null>(null);

  const accounts = useMemo(
    () =>
      reference.accounts
        .filter(
          (account) =>
            kind != null &&
            !account.archived &&
            (kind === "card" ? account.kind === "credit_card" : BANK_KINDS.has(account.kind))
        )
        .map((account) => ({
          value: account.id,
          label: account.name,
          color: account.color,
          hint: [account.personName, ACCOUNT_KIND_LABEL[account.kind]].filter(Boolean).join(" · ")
        })),
    [reference.accounts, kind]
  );

  const loadBatches = useCallback(async () => {
    try {
      setBatches(await importApi.list());
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao carregar importações", "error");
    }
  }, [toast]);

  useEffect(() => void loadBatches(), [loadBatches]);

  const queue = useMemo(() => (view ? needsReview(view.rows) : []), [view]);
  const lookalikes = useMemo(() => queue.filter((row) => row.duplicate != null), [queue]);
  const openRow = view?.rows.find((row) => row.id === openRowId) ?? null;

  /**
   * Depois de cada resposta, o próximo da fila **depois** do que acabou de ser
   * respondido — quem escolheu um lançamento no meio da lista segue dali, e
   * só volta ao começo quando chega ao fim.
   */
  function advance(next: ImportBatchView, fromRowId?: number) {
    const answered = view?.rows.find((row) => row.id === fromRowId);
    setView(next);
    const pendingRows = needsReview(next.rows);
    const pending =
      (answered ? pendingRows.find((row) => reviewOrder(row, answered) > 0) : undefined) ??
      pendingRows[0];
    setOpenRowId(pending?.id ?? null);
    if (!pending) {
      const ready = next.counts.ready;
      toast.notify(
        ready > 0
          ? `Revisão concluída. ${ready} lançamento(s) automático(s) prontos para importar.`
          : "Revisão concluída"
      );
    }
  }

  async function sendFile(password?: string) {
    if (!file || accountId == null || kind == null) return;
    setUploading(true);
    try {
      const next = await importApi.upload(accountId, kind, file, password);
      setPasswordPrompt(null);
      if (next.previousImportAt) {
        toast.notify(
          `Este arquivo já foi enviado em ${ledgerDate(next.previousImportAt.slice(0, 10))}. O que já entrou aparece como "Já importado".`
        );
      }
      setFile(null);
      await loadBatches();
      advance(next);
    } catch (cause) {
      if (cause instanceof ImportUploadError && cause.code === "pdf_password_required") {
        setPasswordPrompt({ incorrect: false });
      } else if (cause instanceof ImportUploadError && cause.code === "pdf_password_incorrect") {
        setPasswordPrompt({ incorrect: true });
      } else {
        toast.notify(cause instanceof Error ? cause.message : "Falha ao ler o arquivo", "error");
      }
    } finally {
      setUploading(false);
    }
  }

  async function openBatch(batchId: number) {
    try {
      const next = await importApi.get(batchId);
      setView(next);
      setOpenRowId(needsReview(next.rows)[0]?.id ?? null);
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao abrir o lote", "error");
    }
  }

  async function submitRow(row: ImportRowView, body: ImportRowConfirm) {
    if (!view) return;
    setBusy(true);
    try {
      const next = await importApi.confirm(view.batch.id, row.id, body);
      advance(next, row.id);
      void loadBatches();
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao gravar", "error");
    } finally {
      setBusy(false);
    }
  }

  async function reopenRow(row: ImportRowView) {
    if (!view) return;
    try {
      const next = await importApi.reopen(view.batch.id, row.id);
      setView(next);
      setOpenRowId(row.id);
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao reabrir a linha", "error");
    }
  }

  async function commitReady() {
    if (!view) return;
    const ok = await confirm({
      title: "Importar os automáticos",
      message: `Gravar ${view.counts.ready} lançamento(s) com a categoria e o local das regras "sempre automático"?`,
      confirmLabel: "Importar"
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await importApi.commitReady(view.batch.id);
      setView(next);
      toast.notify(`${view.counts.ready} lançamento(s) importado(s)`);
      void loadBatches();
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao importar", "error");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!view) return;
    const pending = view.counts.review + view.counts.ready;
    const ok = await confirm({
      title: "Encerrar lote",
      message: `${pending} lançamento(s) ainda não gravado(s) serão deixados de fora. O que já foi importado continua no livro.`,
      confirmLabel: "Encerrar",
      tone: "danger"
    });
    if (!ok) return;
    try {
      setView(await importApi.discard(view.batch.id));
      void loadBatches();
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao encerrar", "error");
    }
  }

  const categoryName = (id: number | null) =>
    id == null ? null : (reference.categories.find((category) => category.id === id)?.name ?? null);

  if (reference.loading) return <Loading />;

  return (
    <>
      <SectionHeading
        title="Importar extrato ou fatura"
        subtitle="Diga o que o arquivo é, suba o CSV do Nubank (ou OFX, ou Excel) e revise lançamento por lançamento. O que já está no livro é marcado para você conferir, lado a lado."
      />

      <Panel title="Enviar arquivo">
        <fieldset className="fin-import-kinds">
          <legend className="field-label">1. O que você vai importar?</legend>
          <div className="fin-import-kind-grid" role="radiogroup" aria-label="Tipo de arquivo">
            {KIND_CHOICES.map((choice) => {
              const Icon = choice.icon;
              const active = kind === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`fin-import-kind ${active ? "active" : ""}`}
                  onClick={() => {
                    if (kind === choice.value) return;
                    setKind(choice.value);
                    setAccountId(null);
                  }}
                >
                  <Icon size={20} aria-hidden />
                  <span>
                    <strong>{choice.title}</strong>
                    <small>{choice.text}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {kind == null ? (
          <p className="fin-callout">Comece escolhendo se o arquivo é um extrato de conta ou uma fatura de cartão.</p>
        ) : (
          <>
            <div className="fin-import-upload">
              <Field label={kind === "card" ? "2. Cartão" : "2. Conta do extrato"}>
                <Dropdown<number>
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts}
                  placeholder={kind === "card" ? "Escolher cartão" : "Escolher conta"}
                  aria-label={kind === "card" ? "Cartão" : "Conta do extrato"}
                />
              </Field>
              <Field label="3. Arquivo">
                <FilePicker
                  file={file}
                  onChange={setFile}
                  accept=".csv,.ofx,.xls,.xlsx,.pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                  placeholder="CSV, OFX ou Excel; PDF do BTG como reserva. Até 10 MB"
                  aria-label="Escolher o arquivo"
                />
              </Field>
              <Button icon={Upload} onClick={() => void sendFile()} disabled={!file || accountId == null || uploading}>
                {uploading ? "Lendo…" : kind === "card" ? "Ler fatura" : "Ler extrato"}
              </Button>
            </div>
            <p className="fin-callout">
              {HELP[kind]} Lançamento que já está no livro (mesmo valor, até 3 dias de diferença) é
              marcado para você comparar lado a lado e decidir se é o mesmo — nada é vinculado sem
              a sua confirmação.
            </p>
          </>
        )}
      </Panel>

      {view && (
        <Panel
          title={`${view.batch.fileName} · ${view.batch.accountName}`}
          subtitle={
            view.batch.periodStart
              ? `${ledgerDate(view.batch.periodStart)} a ${ledgerDate(view.batch.periodEnd ?? view.batch.periodStart)} · ${view.rows.length} linhas`
              : `${view.rows.length} linhas`
          }
          action={
            <Button variant="ghost" icon={X} onClick={() => setView(null)}>
              Fechar
            </Button>
          }
        >
          <div className="fin-import-summary">
            <Tag tone="warning">{view.counts.review} a revisar</Tag>
            {lookalikes.length > 0 && <Tag tone="info">{lookalikes.length} parecem já estar no livro</Tag>}
            <Tag tone="info">{view.counts.ready} prontos</Tag>
            <Tag tone="positive">{view.counts.committed} importados</Tag>
            <Tag tone="neutral">{view.counts.duplicate} já importados</Tag>
            <Tag tone="neutral">{view.counts.ignored} pulados</Tag>
            {view.batch.status === "discarded" && <Tag tone="negative">Lote encerrado</Tag>}
          </div>
          {view.batch.pdf && <PdfReconciliationBanner info={view.batch.pdf} rowCount={view.rows.length} />}
          {view.batch.status !== "discarded" && (
            <div className="fin-import-toolbar">
              <Button
                icon={ListChecks}
                disabled={queue.length === 0}
                onClick={() => setOpenRowId(queue[0]?.id ?? null)}
              >
                {lookalikes.length > 0 ? `Revisar possíveis duplicados (${lookalikes.length})` : `Revisar (${queue.length})`}
              </Button>
              {lookalikes.length > 0 && queue.length > lookalikes.length && (
                <Button variant="soft" onClick={() => setOpenRowId(queue[0]?.id ?? null)}>
                  Revisar tudo ({queue.length})
                </Button>
              )}
              {/* PDF nao tem "importar tudo": cada linha passa pelo popup. */}
              {!view.batch.pdf && (
                <Button variant="soft" icon={FileUp} disabled={view.counts.ready === 0 || busy} onClick={() => void commitReady()}>
                  Importar prontos ({view.counts.ready})
                </Button>
              )}
              {view.counts.review + view.counts.ready > 0 && (
                <Button variant="ghost" onClick={() => void discard()}>
                  Encerrar lote
                </Button>
              )}
            </div>
          )}

          <div className="table-scroll">
            <table className="data-table fin-import-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Com quem</th>
                  <th>Classificação</th>
                  <th className="right">Valor</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => {
                  const status = row.skippedBefore
                    ? { label: "Já pulado antes", tone: "neutral" }
                    : STATUS[row.status];
                  const editable = row.status === "needs_review" || row.status === "new";
                  const reopenable =
                    view.batch.status !== "discarded" && (row.status === "ignored" || row.status === "duplicate");
                  return (
                    <tr key={row.id}>
                      <td>{ledgerDate(row.date)}</td>
                      <td>
                        <strong>{row.payee.display}</strong>
                        <small className="fin-import-raw-inline">{row.rawDescription}</small>
                      </td>
                      <td>
                        {row.duplicate && row.status === "needs_review" && (
                          <small className="fin-import-match">
                            Parece o lançamento de {ledgerDate(row.duplicate.date)}: {candidateTitle(row.duplicate)}
                          </small>
                        )}
                        {[
                          categoryName(row.suggestion.categoryId),
                          // Sem regra o local sugerido é o próprio nome, já na coluna ao lado.
                          row.rule || row.suggestion.placeName !== row.payee.display
                            ? row.suggestion.placeName
                            : null,
                          row.suggestion.description
                        ]
                          .filter(Boolean)
                          .join(" · ") || <span className="muted">—</span>}
                      </td>
                      <td className={`num right ${row.amountCents < 0 ? "negative" : "positive"}`}>
                        {signedMoneyFromCents(row.amountCents)}
                      </td>
                      <td>
                        <Tag tone={status.tone}>{status.label}</Tag>
                        {row.pdf && !row.pdf.signKnown && <Tag tone="warning">conferir sinal</Tag>}
                        {row.pdf && row.pdf.confidence < LOW_CONFIDENCE && (
                          <span className="fin-pdf-low" title={row.pdf.warnings.join(" ") || "Leitura do PDF com pouca confiança"}>
                            leitura duvidosa
                          </span>
                        )}
                      </td>
                      <td className="fin-import-row-action">
                        {editable && view.batch.status !== "discarded" && (
                          <Button variant="ghost" onClick={() => setOpenRowId(row.id)}>
                            {row.status === "new" ? "Editar" : "Revisar"}
                          </Button>
                        )}
                        {reopenable && (
                          <Button variant="ghost" icon={RotateCcw} onClick={() => void reopenRow(row)}>
                            {row.status === "duplicate" ? "Importar mesmo assim" : "Revisar"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Importações recentes">
        {batches.length === 0 ? (
          <Empty icon={FileUp} text="Nenhum extrato enviado ainda." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Conta</th>
                  <th>Enviado</th>
                  <th className="right">Importados</th>
                  <th className="right">Pendentes</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.fileName}</td>
                    <td>{batch.accountName}</td>
                    <td>{ledgerDate(batch.importedAt.slice(0, 10))}</td>
                    <td className="num right">
                      {batch.committedCount} de {batch.rowCount}
                    </td>
                    <td className="num right">
                      {batch.status === "discarded" ? <Tag tone="neutral">encerrado</Tag> : batch.pendingCount}
                    </td>
                    <td className="fin-import-row-action">
                      <Button variant="ghost" onClick={() => void openBatch(batch.id)}>
                        {batch.pendingCount > 0 && batch.status !== "discarded" ? "Continuar" : "Abrir"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {passwordPrompt && file && (
        <PdfPasswordDialog
          fileName={file.name}
          incorrect={passwordPrompt.incorrect}
          busy={uploading}
          onSubmit={(password) => void sendFile(password)}
          onClose={() => setPasswordPrompt(null)}
        />
      )}

      {view && openRow && (
        <ImportRowDialog
          key={openRow.id}
          row={openRow}
          accountId={view.batch.accountId}
          reference={reference}
          cardInvoice={view.batch.statementKind === "card"}
          queue={view.rows
            .filter((row) => row.status === "needs_review" || row.id === openRow.id)
            .sort(reviewOrder)}
          onPick={setOpenRowId}
          remaining={Math.max(queue.length, 1)}
          busy={busy}
          onSubmit={(body) => submitRow(openRow, body)}
          onClose={() => setOpenRowId(null)}
        />
      )}
    </>
  );
}
