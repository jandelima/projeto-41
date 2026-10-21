import {
  ArrowLeftRight,
  CheckCheck,
  CreditCard,
  Paperclip,
  PiggyBank,
  Receipt,
  TrendingUp,
  Undo2
} from "lucide-react";
import { useMemo, useState } from "react";
import type { EntryRecord } from "@projeto41/contracts";
import { Modal } from "../dialog.js";
import { Empty } from "../ui.js";
import { InstallmentBadge, installmentOf } from "./InstallmentBadge.js";
import { moneyFromCents, signedMoneyFromCents, todayIso } from "../../lib/format.js";
import { attachmentThumbUrl, attachmentUrl } from "../../lib/ledger.js";

/**
 * O livro, agrupado por dia.
 *
 * Transacoes, Gastos, Entradas e o extrato da caixinha usam exatamente este
 * componente: a diferenca entre as telas e so o filtro, entao o design e
 * identico por construcao, e nao por disciplina.
 *
 * Cada dia mostra o saldo do que entrou e saiu nele. Transferencia fica fora
 * dessa conta: mover dinheiro entre contas proprias nao e ganhar nem gastar.
 */

type DayGroup = { date: string; rows: EntryRecord[]; netCents: number };

/**
 * Transferência tem duas pontas, e sem filtro de conta as duas aparecem: a
 * mesma movimentação em duas linhas, uma positiva e outra negativa. Fica só a
 * de saída, que já diz "de onde → para onde". Com filtro de conta sobra uma
 * ponta só, e ela continua aparecendo com o sinal daquela conta.
 */
function withoutMirroredLegs(rows: EntryRecord[]): EntryRecord[] {
  const outgoing = new Set(
    rows
      .filter((entry) => entry.transferId != null && entry.amountCents < 0)
      .map((entry) => entry.transferId)
  );
  return rows.filter(
    (entry) => !(entry.transferId != null && entry.amountCents > 0 && outgoing.has(entry.transferId))
  );
}

function groupByDay(rows: EntryRecord[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of withoutMirroredLegs(rows)) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== entry.date) {
      group = { date: entry.date, rows: [], netCents: 0 };
      groups.push(group);
    }
    group.rows.push(entry);
    if (entry.kind === "income" || entry.kind === "expense") group.netCents += entry.amountCents;
  }
  return groups;
}

/** "Quinta-feira" e "24 de setembro", separados para o cabeçalho do dia. */
function dayParts(date: string, today = todayIso()) {
  const value = new Date(`${date}T12:00:00`);
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameYear = value.getFullYear() === new Date(`${today}T12:00:00`).getFullYear();
  const weekday = value.toLocaleDateString("pt-BR", { weekday: "long" });
  const rest = value.toLocaleDateString("pt-BR", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" })
  });
  const relative = date === today ? "Hoje" : date === todayIso(yesterday) ? "Ontem" : null;
  return {
    day: String(value.getDate()).padStart(2, "0"),
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1),
    month: rest,
    relative
  };
}

/**
 * A categoria abre a linha, com nome e cor: é a primeira coisa que se quer
 * saber de um gasto. O que não tem categoria diz o que é — transferência,
 * estorno, caixinha — no mesmo lugar, para a coluna nunca ficar vazia.
 */
function CategoryPill({ entry }: { entry: EntryRecord }) {
  const special =
    entry.refundOfEntryId != null
      ? { icon: Undo2, label: "Estorno" }
      : entry.goalId != null
        ? { icon: PiggyBank, label: "Caixinha" }
        : entry.transferPurpose === "investment"
          ? { icon: TrendingUp, label: entry.amountCents < 0 ? "Aporte" : "Resgate" }
          : entry.kind === "transfer"
            ? { icon: ArrowLeftRight, label: "Transferência" }
            : null;
  if (special && !entry.categoryName) {
    const Icon = special.icon;
    return (
      <span className={`fin-cat-pill neutral ${entry.kind}`}>
        <Icon size={13} aria-hidden />
        <span>{special.label}</span>
      </span>
    );
  }
  if (!entry.categoryName) {
    return (
      <span className="fin-cat-pill blank">
        <span>{entry.kind === "income" ? "Entrada" : entry.kind === "adjustment" ? "Ajuste" : "Sem categoria"}</span>
      </span>
    );
  }
  return (
    <span
      className="fin-cat-pill"
      style={{ "--cat-color": entry.categoryColor ?? "#8b949e" } as React.CSSProperties}
      title={entry.categoryName}
    >
      <i aria-hidden />
      <span>{entry.categoryName}</span>
    </span>
  );
}

/** Quem pagou, com a cor da pessoa: numa casa com duas pessoas, é metade da pergunta. */
function Payer({ entry }: { entry: EntryRecord }) {
  if (!entry.personName) return <span className="fin-payer none">—</span>;
  return (
    <span
      className="fin-payer"
      style={{ "--payer-color": entry.personColor ?? "#8b949e" } as React.CSSProperties}
      title={
        entry.amountCents > 0 ? `Veio de ${entry.personName}` : `Pago por ${entry.personName}`
      }
    >
      <b aria-hidden>{entry.personName.charAt(0).toUpperCase()}</b>
      <span>{entry.personName}</span>
    </span>
  );
}

export function EntryTable({
  rows,
  onSelect,
  emptyText = "Nenhum lançamento no período."
}: {
  rows: EntryRecord[];
  onSelect: (entry: EntryRecord) => void;
  emptyText?: string;
}) {
  const [photo, setPhoto] = useState<{ id: number; label: string } | null>(null);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  // Transferências cujas duas pontas estão na lista: viram uma linha só.
  const mergedTransfers = useMemo(() => {
    const seen = new Map<number, number>();
    for (const entry of rows) {
      if (entry.transferId != null) seen.set(entry.transferId, (seen.get(entry.transferId) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([id]) => id));
  }, [rows]);

  if (rows.length === 0) return <Empty icon={Receipt} text={emptyText} />;

  return (
    <>
      <div className="fin-feed">
        {groups.map((group) => (
          <section className="fin-day" key={group.date}>
            <DayHeader group={group} />
            <ul>
              {group.rows.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  merged={entry.transferId != null && mergedTransfers.has(entry.transferId)}
                  onSelect={onSelect}
                  onPhoto={(id, label) => setPhoto({ id, label })}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {photo && (
        <Modal title={photo.label} onClose={() => setPhoto(null)}>
          <img className="fin-photo-full" src={attachmentUrl(photo.id)} alt={photo.label} />
        </Modal>
      )}
    </>
  );
}

function DayHeader({ group }: { group: DayGroup }) {
  const parts = dayParts(group.date);
  return (
    <header className="fin-day-head">
      <span className="fin-day-date">
        <span className="fin-day-number">{parts.day}</span>
        <span className="fin-day-text">
          <strong>
            {parts.relative ? `${parts.relative} · ` : ""}
            {parts.weekday}
          </strong>
          <small>{parts.month}</small>
        </span>
      </span>
      <span className="fin-day-side">
        <small>
          {group.rows.length} lançamento{group.rows.length === 1 ? "" : "s"}
        </small>
        {group.netCents !== 0 && (
          <strong
            className={group.netCents < 0 ? "fin-negative" : "fin-positive"}
            title="Entradas menos saídas do dia, sem transferências"
          >
            {signedMoneyFromCents(group.netCents)}
          </strong>
        )}
      </span>
    </header>
  );
}

function EntryRow({
  entry,
  merged,
  onSelect,
  onPhoto
}: {
  entry: EntryRecord;
  /** As duas pontas da transferência estão na lista: o valor sai sem sinal. */
  merged: boolean;
  onSelect: (entry: EntryRecord) => void;
  onPhoto: (id: number, label: string) => void;
}) {
  const isTransfer = entry.kind === "transfer";
  const attachment = entry.attachments[0];
  const title = entry.description ?? entry.placeName ?? (isTransfer ? "Transferência" : "Sem descrição");

  // A linha de detalhe responde "onde e de que conta" sem abrir nada.
  const meta: React.ReactNode[] = [];
  if (entry.placeName && entry.description) meta.push(<span key="place">{entry.placeName}</span>);
  if (isTransfer && entry.counterpartAccountName) {
    meta.push(
      <span key="account">
        {entry.amountCents < 0
          ? `${entry.accountName} → ${entry.counterpartAccountName}`
          : `${entry.counterpartAccountName} → ${entry.accountName}`}
      </span>
    );
  } else if (entry.accountKind === "credit_card") {
    // Compra no cartão ganha um selo: é dinheiro que só sai na fatura, e na
    // lista de tudo precisa se destacar do que já saiu da conta.
    meta.push(
      <span key="account" className="fin-card-chip" title={`No cartão ${entry.accountName}`}>
        <CreditCard size={12} aria-hidden />
        {entry.accountName}
      </span>
    );
  } else {
    meta.push(<span key="account">{entry.accountName}</span>);
  }

  return (
    <li className={`fin-entry ${entry.status === "pending" ? "pending" : ""}`}>
      <CategoryPill entry={entry} />

      <button type="button" className="fin-entry-main" onClick={() => onSelect(entry)}>
        <span className="fin-entry-title">
          <span className="fin-entry-name">{title}</span>
          <InstallmentBadge entry={entry} long />
          {entry.goalId != null && entry.goalName && (
            // Movimento de caixinha continua sendo transferência: não vira
            // receita nem despesa em relatório nenhum (D21).
            <em
              className="fin-goal-chip"
              style={{ borderColor: entry.goalColor ?? undefined }}
              title={`Caixinha ${entry.goalName}`}
            >
              <PiggyBank size={11} aria-hidden />
              {entry.goalName}
            </em>
          )}
          {entry.tags
            .filter((tag) => !(tag.name === "Parcela" && installmentOf(entry)))
            .map((tag) => (
            <em key={tag.id} className="fin-tag-chip" style={{ borderColor: tag.color }}>
              {tag.name}
            </em>
          ))}
        </span>
        <span className="fin-entry-meta">{meta}</span>
      </button>

      <Payer entry={entry} />

      {attachment ? (
        <button
          type="button"
          className="fin-thumb"
          onClick={() => onPhoto(attachment.id, entry.description ?? entry.placeName ?? "Comprovante")}
          aria-label="Ver comprovante"
        >
          <img src={attachmentThumbUrl(attachment.id)} alt="" loading="lazy" />
          {entry.attachments.length > 1 && (
            <span className="fin-clip" title={`${entry.attachments.length} anexos`}>
              <Paperclip size={10} />
              {entry.attachments.length}
            </span>
          )}
        </button>
      ) : (
        <span className="fin-thumb-spacer" aria-hidden />
      )}

      <span className="fin-entry-side">
        <strong
          className={`fin-amount ${
            // Transferência e troca de caixa por ativo mudam o dinheiro de
            // lugar: não são ganho nem gasto, então não levam cor.
            isTransfer || entry.kind === "adjustment"
              ? ""
              : entry.amountCents < 0
                ? "fin-negative"
                : "fin-positive"
          }`}
        >
          {merged ? moneyFromCents(Math.abs(entry.amountCents)) : signedMoneyFromCents(entry.amountCents)}
        </strong>
        {entry.status === "pending" && <em className="fin-status-pill">Pendente</em>}
        {entry.status === "reconciled" && (
          <em className="fin-status-ok" title="Conciliado com o extrato">
            <CheckCheck size={12} aria-hidden />
            Conciliado
          </em>
        )}
      </span>
    </li>
  );
}
