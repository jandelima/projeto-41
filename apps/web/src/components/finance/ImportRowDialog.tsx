import { Check, Link2, SkipForward } from "lucide-react";
import { useMemo, useState } from "react";
import type { ImportRowConfirm, ImportRowView, PayeeRemember } from "@projeto41/contracts";
import { Modal } from "../dialog.js";
import { Dropdown } from "../forms.js";
import { Button, Field, Segmented, Tag } from "../ui.js";
import { PlaceAutocomplete } from "./EntryDrawer.js";
import { CandidatePicker, ImportCompare } from "./ImportCompare.js";
import { ledgerDate, monthLabel, signedMoneyFromCents, weekdayName } from "../../lib/format.js";
import { ACCOUNT_KIND_LABEL, isCard, type LedgerReference } from "../../lib/ledger.js";

type Kind = "expense" | "income" | "transfer";
type Action = "create" | "link";

/**
 * Popup da revisão: um lançamento do extrato por vez.
 *
 * Abre com a sugestão da regra do destinatário (ou o que dá para deduzir do
 * descritor), deixa mudar tudo o que o livro guarda e, no fim, pergunta o que
 * fazer com os próximos lançamentos do mesmo destinatário.
 *
 * Quem usa passa `key={row.id}`: cada linha nova recomeça do zero, sem herdar
 * a resposta anterior.
 */
export function ImportRowDialog({
  row,
  accountId,
  reference,
  cardInvoice = false,
  queue,
  onPick,
  remaining,
  busy,
  onSubmit,
  onClose
}: {
  row: ImportRowView;
  accountId: number;
  reference: LedgerReference;
  /** Linha de fatura: não tem transferência entre contas. */
  cardInvoice?: boolean;
  /** Os lançamentos da fila, na ordem do arquivo, para a lista ao lado. */
  queue: ImportRowView[];
  /** Trocar para outro lançamento da lista (descarta o que foi digitado neste). */
  onPick: (rowId: number) => void;
  /** Quantos ainda esperam revisão, contando este. */
  remaining: number;
  busy: boolean;
  onSubmit: (body: ImportRowConfirm) => Promise<void>;
  onClose: () => void;
}) {
  const outgoing = row.amountCents < 0;
  const natural: Kind = outgoing ? "expense" : "income";

  // O sistema nunca vincula sozinho: so propõe. Muito provável abre em "vincular";
  // possível abre em "criar novo", e o usuário confere os dois lados.
  const candidates = useMemo(
    () => (row.duplicate ? [row.duplicate, ...row.alternatives] : []),
    [row.duplicate, row.alternatives]
  );
  const [linkEntryId, setLinkEntryId] = useState<number | null>(row.duplicate?.entryId ?? null);
  const chosen = candidates.find((candidate) => candidate.entryId === linkEntryId) ?? null;
  const [action, setAction] = useState<Action>(
    row.duplicate && !row.duplicate.blocked && row.duplicate.confidence !== "possible" ? "link" : "create"
  );
  const [kind, setKind] = useState<Kind>(row.suggestion.kind);
  const [toAccountId, setToAccountId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(row.suggestion.categoryId);
  const [description, setDescription] = useState(row.suggestion.description ?? "");
  const [placeName, setPlaceName] = useState(row.suggestion.placeName ?? "");
  const [personId, setPersonId] = useState<number | null>(row.suggestion.personId);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [remember, setRemember] = useState<PayeeRemember>(
    row.rule ? (row.rule.ignore ? "ignore" : row.rule.mode) : "ask"
  );

  const categories = useMemo(
    () =>
      reference.categories
        .filter((category) => category.kind === kind && !category.archived)
        .map((category) => ({ value: category.id, label: category.name, color: category.color ?? null })),
    [reference.categories, kind]
  );

  const otherAccounts = useMemo(
    () =>
      reference.accounts
        .filter((account) => account.id !== accountId && !account.archived && !isCard(account))
        .filter((account) => account.kind !== "investment")
        .map((account) => ({
          value: account.id,
          label: account.name,
          color: account.color,
          hint: [account.personName, ACCOUNT_KIND_LABEL[account.kind]].filter(Boolean).join(" · ")
        })),
    [reference.accounts, accountId]
  );

  const ignoring = remember === "ignore" && action === "create" && kind !== "transfer";
  const canRemember = action === "link" || kind !== "transfer";
  const direction = outgoing ? "Próximas saídas para" : "Próximas entradas de";
  // Quem recebe o dinheiro é destinatário; quem manda, remetente.
  const party = outgoing ? "Destinatário" : "Remetente";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (action === "link") {
      void onSubmit({
        action: "link",
        linkEntryId: chosen?.entryId ?? null,
        remember: remember === "ignore" ? "none" : remember
      });
      return;
    }
    if (ignoring) {
      void onSubmit({ action: "skip", remember: "ignore" });
      return;
    }
    void onSubmit({
      action: "create",
      kind,
      toAccountId: kind === "transfer" ? toAccountId : null,
      categoryId: kind === "transfer" ? null : categoryId,
      placeName: kind === "transfer" ? null : placeName.trim() || null,
      description: description.trim() || null,
      notes: notes.trim() || null,
      personId,
      tagIds,
      remember: canRemember ? remember : "none"
    });
  }

  const primaryLabel =
    action === "link" ? "Vincular e seguir" : ignoring ? "Ignorar e seguir" : "Confirmar e seguir";
  const transferMissing = action === "create" && kind === "transfer" && toAccountId == null;
  const linkBlocked = action === "link" && (chosen == null || chosen.blocked != null);

  return (
    <Modal
      title={
        <>
          Revisar lançamento <span className="fin-import-count">{remaining} na fila</span>
        </>
      }
      onClose={onClose}
      width={1000}
    >
      <div className="fin-import-layout">
        <nav className="fin-import-queue" aria-label="Lançamentos a revisar">
          <ol>
            {queue.map((item) => {
              const current = item.id === row.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={current ? "active" : ""}
                    aria-current={current ? "true" : undefined}
                    disabled={busy}
                    onClick={() => !current && onPick(item.id)}
                  >
                    <span className="fin-import-queue-top">
                      <strong>{item.suggestion.description || item.payee.display}</strong>
                      <span className={item.amountCents < 0 ? "negative" : "positive"}>
                        {signedMoneyFromCents(item.amountCents)}
                      </span>
                    </span>
                    <span className="fin-import-queue-meta">
                      {weekdayName(item.date, "short")}, {ledgerDate(item.date)}
                      {item.time ? ` · ${item.time}` : ""}
                      {item.installment ? ` · ${item.installment.number}/${item.installment.total}` : ""}
                      {item.duplicate ? " · parece já estar no livro" : ""}
                      {item.status === "new" ? " · automático" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <form className="fin-import-form" onSubmit={submit}>
          <div className="fin-import-scroll">
            <div className="fin-import-head">
              <div>
                <span className="fin-import-date">
                  {weekdayName(row.date)}, {ledgerDate(row.date)}
                  {row.time ? ` · ${row.time}` : ""}
                </span>
                <strong className="fin-import-payee">{row.payee.display}</strong>
                <div className="fin-import-tags">
                  {row.paymentMethod === "pix" && <Tag tone="info">Pix</Tag>}
                  {row.paymentMethod === "debit" && <Tag tone="info">Débito</Tag>}
                  {row.installment && (
                    <Tag tone="info">
                      Parcela {row.installment.number}/{row.installment.total}
                    </Tag>
                  )}
                  {row.statementMonth && (
                    <Tag tone="neutral">Fatura de {monthLabel(row.statementMonth).toLowerCase()}</Tag>
                  )}
                  {row.rule?.mode === "ask" && <Tag tone="warning">{party}: perguntar sempre</Tag>}
                  {!row.rule && <Tag tone="warning">{party} novo</Tag>}
                </div>
              </div>
              <span className={`fin-import-amount ${outgoing ? "negative" : "positive"}`}>
                {signedMoneyFromCents(row.amountCents)}
              </span>
            </div>
            <p className="fin-import-raw" title={row.rawDescription}>
              {row.rawDescription}
            </p>

            {chosen && (
              <section className="fin-callout fin-import-dup" aria-label="Possível duplicado">
                <p>
                  <strong>Parece já estar no livro.</strong> Confira os dois lados e diga se é o mesmo lançamento.
                </p>
                <CandidatePicker row={row} candidates={candidates} value={linkEntryId} onChange={setLinkEntryId} />
                <ImportCompare row={row} candidate={chosen} />
                <Segmented<Action>
                  value={action}
                  onChange={(next) => {
                    setAction(next);
                    // Vincular grava a linha, entao "ignorar sempre" nao se aplica.
                    if (next === "link" && remember === "ignore") setRemember("ask");
                  }}
                  options={[
                    { value: "link", label: "É o mesmo: vincular" },
                    { value: "create", label: "É outro: criar novo" }
                  ]}
                />
              </section>
            )}

            {action === "create" && (
              <div className="fin-import-grid">
                {/* Na fatura do cartao, compra e compra: nao ha outra conta. */}
                {!cardInvoice && (
                  <Field label="Tipo">
                    <Segmented<Kind>
                      value={kind}
                      onChange={(next) => {
                        setKind(next);
                        if (next !== kind) setCategoryId(null);
                      }}
                      options={[
                        { value: natural, label: outgoing ? "Saída" : "Entrada" },
                        { value: "transfer", label: "Transferência" }
                      ]}
                    />
                  </Field>
                )}

                {kind === "transfer" ? (
                  <Field label={outgoing ? "Para qual conta" : "De qual conta"}>
                    <Dropdown<number>
                      value={toAccountId}
                      onChange={setToAccountId}
                      options={otherAccounts}
                      placeholder="Escolher conta"
                      aria-label="Outra conta"
                    />
                  </Field>
                ) : (
                  <Field label="Categoria">
                    <Dropdown<number>
                      value={categoryId}
                      onChange={setCategoryId}
                      emptyLabel="Sem categoria"
                      options={categories}
                      aria-label="Categoria"
                    />
                  </Field>
                )}


                {kind !== "transfer" && (
                  <PlaceAutocomplete
                    value={placeName}
                    hint={null}
                    onChange={(name, place) => {
                      setPlaceName(name);
                      if (place?.defaultCategoryId != null && categoryId == null) {
                        setCategoryId(place.defaultCategoryId);
                      }
                    }}
                  />
                )}

                <Field label="Descrição" full={kind === "transfer" || cardInvoice}>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="O título que aparece no livro"
                    maxLength={200}
                    autoFocus
                  />
                </Field>

                {/* Quem, etiquetas e observação quase nunca mudam: uma linha só,
                    com controles pequenos, em vez de três campos cheios. */}
                <div className="fin-import-extras">
                  <div className="fin-import-chip">
                    <span>Quem</span>
                    <Dropdown<number>
                      value={personId}
                      onChange={setPersonId}
                      emptyLabel="Ninguém"
                      options={reference.people
                        .filter((person) => person.active || person.id === personId)
                        .map((person) => ({ value: person.id, label: person.name, color: person.color }))}
                      aria-label="Quem"
                    />
                  </div>
                  {reference.tags.length > 0 && (
                    <div className="fin-import-chip">
                      <span>Etiquetas</span>
                      <Dropdown<number>
                        multiple
                        value={tagIds}
                        onChange={setTagIds}
                        placeholder="nenhuma"
                        options={reference.tags.map((tag) => ({
                          value: tag.id,
                          label: tag.name,
                          color: tag.color
                        }))}
                        aria-label="Etiquetas"
                      />
                    </div>
                  )}
                  {!notesOpen && (
                    <button type="button" className="fin-import-more" onClick={() => setNotesOpen(true)}>
                      + Observação
                    </button>
                  )}
                </div>

                {notesOpen && (
                  <textarea
                    className="fin-import-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Observação"
                    aria-label="Observação"
                    autoFocus
                  />
                )}
              </div>
            )}

            {canRemember && (
              <div className="fin-import-remember">
                <span className="field-label">
                  {direction} <strong>{row.payee.display}</strong>
                </span>
                <Segmented<PayeeRemember>
                  value={remember}
                  onChange={setRemember}
                  options={[
                    { value: "auto", label: "Sempre automático" },
                    { value: "ask", label: "Perguntar sempre" },
                    { value: "none", label: "Não lembrar" },
                    ...(action === "create" ? [{ value: "ignore" as const, label: "Ignorar sempre" }] : [])
                  ]}
                />
                <small className="field-hint">
                  {action === "link" && remember !== "none" && "Usa a categoria e o local do lançamento existente. "}
                  {remember === "auto" &&
                    action === "create" &&
                    "Os próximos entram prontos com esta categoria e local, sem abrir este popup. A descrição fica em branco."}
                  {remember === "auto" && action === "link" && "Os próximos entram prontos, sem abrir este popup."}
                  {remember === "ask" && "Os próximos abrem este popup com a categoria e o local já preenchidos."}
                  {remember === "none" && "Nada é guardado: os próximos chegam em branco."}
                  {remember === "ignore" &&
                    `Este não é gravado, e os próximos deste ${party.toLowerCase()} são pulados sozinhos.`}
                </small>
              </div>
            )}
          </div>

          <div className="fin-import-actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Pausar
            </Button>
            <Button
              type="button"
              variant="soft"
              icon={SkipForward}
              disabled={busy}
              onClick={() => void onSubmit({ action: "skip", remember: "none" })}
            >
              Pular
            </Button>
            <Button
              type="submit"
              icon={action === "link" ? Link2 : Check}
              disabled={busy || transferMissing || linkBlocked}
            >
              {busy ? "Gravando…" : primaryLabel}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
