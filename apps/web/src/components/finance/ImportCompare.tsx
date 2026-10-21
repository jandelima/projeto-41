import type { ImportCandidate, ImportRowView } from "@projeto41/contracts";
import { Tag } from "../ui.js";
import { ledgerDate, signedMoneyFromCents } from "../../lib/format.js";

const CONFIDENCE: Record<ImportCandidate["confidence"], { label: string; tone: string }> = {
  certain: { label: "Certeza", tone: "positive" },
  likely: { label: "Muito provável", tone: "info" },
  possible: { label: "Possível", tone: "warning" }
};

const KIND_LABEL: Record<ImportCandidate["kind"], string> = {
  expense: "Saída",
  income: "Entrada",
  transfer: "Transferência",
  adjustment: "Ajuste"
};

const STATUS_LABEL: Record<ImportCandidate["status"], string> = {
  pending: "Previsto",
  cleared: "Confirmado",
  reconciled: "Conciliado"
};

/** Texto de um lançamento do livro: o que o usuário escreveu, senão o local. */
export function candidateTitle(candidate: ImportCandidate): string {
  return (
    [candidate.description, candidate.placeName].filter(Boolean).join(" · ") ||
    (candidate.transferWith ? `Transferência · ${candidate.transferWith}` : "Sem descrição")
  );
}

/**
 * O que muda no lançamento se ele for vinculado à linha do arquivo. O arquivo é
 * a verdade do banco: valor e dia passam a ser os dele, o previsto vira
 * confirmado, e categoria, local e descrição continuam do usuário. Parcela
 * mantém o dia do plano.
 */
export function linkChanges(row: ImportRowView, candidate: ImportCandidate): string[] {
  const changes: string[] = [];
  if (row.amountCents !== candidate.amountCents) {
    changes.push(`o valor passa de ${signedMoneyFromCents(candidate.amountCents)} para ${signedMoneyFromCents(row.amountCents)}`);
  }
  if (row.date !== candidate.date && !candidate.installment) {
    changes.push(`o dia passa de ${ledgerDate(candidate.date)} para ${ledgerDate(row.date)}`);
  }
  if (candidate.status === "pending") changes.push("deixa de ser previsto e fica confirmado");
  return changes;
}

/** As datas abreviadas ("04 de out.") já terminam em ponto. */
function endSentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/**
 * Os dois lados de um possível duplicado, lado a lado: o que o arquivo diz e o
 * que o livro já tem. O que difere (dia, valor) fica marcado, porque é nisso
 * que o usuário decide se é o mesmo lançamento.
 */
export function ImportCompare({ row, candidate }: { row: ImportRowView; candidate: ImportCandidate }) {
  const dateDiffers = row.date !== candidate.date;
  const amountDiffers = row.amountCents !== candidate.amountCents;
  const confidence = CONFIDENCE[candidate.confidence];
  const changes = linkChanges(row, candidate);

  return (
    <div className="fin-compare">
      <div className="fin-compare-head">
        <Tag tone={confidence.tone}>{confidence.label}</Tag>
        <span className="fin-compare-muted">
          {candidate.dayDistance === 0
            ? "no mesmo dia"
            : `${candidate.dayDistance} dia${candidate.dayDistance > 1 ? "s" : ""} de diferença`}
        </span>
      </div>
      <table className="fin-compare-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="fin-sr">Campo</span>
            </th>
            <th scope="col">No arquivo</th>
            <th scope="col">No livro</th>
          </tr>
        </thead>
        <tbody>
          <tr className={dateDiffers ? "differs" : ""}>
            <th scope="row">Dia</th>
            <td>
              {ledgerDate(row.date)}
              {row.time ? ` · ${row.time}` : ""}
            </td>
            <td>{ledgerDate(candidate.date)}</td>
          </tr>
          <tr className={amountDiffers ? "differs" : ""}>
            <th scope="row">Valor</th>
            <td className={row.amountCents < 0 ? "negative" : "positive"}>{signedMoneyFromCents(row.amountCents)}</td>
            <td className={candidate.amountCents < 0 ? "negative" : "positive"}>
              {signedMoneyFromCents(candidate.amountCents)}
            </td>
          </tr>
          <tr>
            <th scope="row">Descrição</th>
            <td>
              <strong>{row.payee.display}</strong>
              <small>{row.rawDescription}</small>
            </td>
            <td>
              <strong>{candidateTitle(candidate)}</strong>
              {candidate.categoryName && <small>{candidate.categoryName}</small>}
            </td>
          </tr>
          <tr>
            <th scope="row">Tipo</th>
            <td>{row.amountCents < 0 ? "Saída" : "Entrada"}</td>
            <td>
              {KIND_LABEL[candidate.kind]}
              {candidate.transferWith ? ` · ${candidate.transferWith}` : ""}
              {candidate.installment ? ` · parcela ${candidate.installment.number}/${candidate.installment.total}` : ""}
            </td>
          </tr>
          <tr>
            <th scope="row">Situação</th>
            <td>Do banco</td>
            <td>
              {STATUS_LABEL[candidate.status]}
              {candidate.personName ? ` · ${candidate.personName}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {candidate.blocked ? (
        <p className="fin-compare-note blocked">{endSentence(candidate.blocked)}</p>
      ) : (
        <p className="fin-compare-note">
          {changes.length > 0
            ? `Ao vincular: ${endSentence(changes.join("; "))} Categoria, local e descrição continuam os seus.`
            : "Ao vincular, o lançamento fica como está e passa a constar como conferido com o arquivo."}
        </p>
      )}
    </div>
  );
}

/** A lista para trocar de candidato quando o sistema achou mais de um. */
export function CandidatePicker({
  row,
  candidates,
  value,
  onChange
}: {
  row: ImportRowView;
  candidates: ImportCandidate[];
  value: number | null;
  onChange: (entryId: number) => void;
}) {
  if (candidates.length < 2) return null;
  return (
    <fieldset className="fin-compare-picker">
      <legend>Mais de um lançamento parecido — qual é?</legend>
      {candidates.map((candidate) => (
        <label key={candidate.entryId} className={candidate.entryId === value ? "active" : ""}>
          <input
            type="radio"
            name="import-candidate"
            checked={candidate.entryId === value}
            onChange={() => onChange(candidate.entryId)}
          />
          <span className="fin-compare-option">
            <strong>{candidateTitle(candidate)}</strong>
            <small>
              {ledgerDate(candidate.date)} · {signedMoneyFromCents(candidate.amountCents)}
              {candidate.amountCents !== row.amountCents ? " (valor diferente)" : ""}
            </small>
          </span>
          <Tag tone={CONFIDENCE[candidate.confidence].tone}>{CONFIDENCE[candidate.confidence].label}</Tag>
        </label>
      ))}
    </fieldset>
  );
}
