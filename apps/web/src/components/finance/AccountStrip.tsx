import { CreditCard } from "lucide-react";
import type { LedgerSummary } from "@projeto41/contracts";
import { ColorDot } from "../ColorPicker.js";
import { debtFromCents, ledgerDate, moneyFromCents, signedMoneyFromCents } from "../../lib/format.js";

type SummaryAccount = LedgerSummary["accounts"][number];

/** Contas que guardam o dinheiro do dia a dia. Caixinha e investimento ficam
 * na lista completa mais abaixo: aqui só o que se confere antes de gastar. */
const MAIN_KINDS = new Set(["checking", "cash", "meal_voucher"]);

/**
 * Saldo de cada conta, com entradas, saídas e líquido do período, e a fatura
 * de cada cartão, numa faixa compacta.
 *
 * O cartão aparece dentro da conta que paga a fatura: é de lá que o dinheiro
 * sai no vencimento. Saldo e fatura ficam lado a lado, nunca somados.
 * Cartão sem conta de pagamento visível ganha o próprio bloco.
 */
export function AccountStrip({ accounts }: { accounts: SummaryAccount[] }) {
  const cards = accounts.filter((account) => account.kind === "credit_card");
  const main = accounts.filter((account) => MAIN_KINDS.has(account.kind));
  const shown = new Set(main.map((account) => account.id));
  const cardsOf = (accountId: number) => cards.filter((card) => card.paymentAccountId === accountId);
  const orphans = cards.filter((card) => card.paymentAccountId == null || !shown.has(card.paymentAccountId));

  if (main.length === 0 && cards.length === 0) return null;

  return (
    <div className="fin-strip" aria-label="Saldo das contas e faturas">
      {main.map((account) => (
        <div key={account.id} className="fin-strip-item">
          <span className="fin-strip-name">
            <ColorDot color={account.color} />
            {account.name}
          </span>
          <strong className={account.currentBalanceCents < 0 ? "fin-negative" : ""}>
            {moneyFromCents(account.currentBalanceCents)}
          </strong>
          <Flows flows={account.flows} goalsCents={account.goalsCents} cards={cardsOf(account.id)} />
        </div>
      ))}
      {orphans.map((card) => (
        <div key={card.id} className="fin-strip-item">
          <span className="fin-strip-name">
            <ColorDot color={card.color} />
            {card.name}
          </span>
          <CardLine card={card} standalone />
        </div>
      ))}
    </div>
  );
}

function CardLine({ card, standalone = false }: { card: SummaryAccount; standalone?: boolean }) {
  const statement = card.statement;
  const amount = statement?.amountCents ?? 0;
  return (
    <span className="fin-strip-card" title={`${card.name}: fatura corrente`}>
      <CreditCard size={13} aria-hidden />
      <span>{standalone ? "Fatura" : card.name}</span>
      <b className={amount > 0 ? "fin-negative" : ""}>{debtFromCents(amount)}</b>
      <small>
        {[
          card.flows.expenseCents !== 0 && `${debtFromCents(card.flows.expenseCents)} em compras no período`,
          statement && `fecha ${ledgerDate(statement.closingDate)} · vence ${ledgerDate(statement.dueDate)}`
        ]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </span>
  );
}

/**
 * Duas linhas no mesmo grid de três colunas: entradas, saídas e líquido do
 * período em cima; fatura do cartão (duas colunas) e caixinhas embaixo. O
 * ciclo da fatura fica numa linha curta no fim, para o card não crescer.
 */
function Flows({
  flows,
  goalsCents,
  cards
}: {
  flows: SummaryAccount["flows"];
  goalsCents: number;
  cards: SummaryAccount[];
}) {
  return (
    <dl className="fin-strip-flows">
      <div>
        <dt>Entradas</dt>
        <dd className="fin-positive">{moneyFromCents(flows.incomeCents)}</dd>
      </div>
      <div>
        <dt>Saídas</dt>
        <dd className="fin-negative">{moneyFromCents(Math.abs(flows.expenseCents))}</dd>
      </div>
      <div>
        <dt>Líquido</dt>
        <dd className={flows.netCents < 0 ? "fin-negative" : ""}>{signedMoneyFromCents(flows.netCents)}</dd>
      </div>
      {cards.length === 0 ? (
        <div className="fin-strip-flows-card" />
      ) : (
        cards.map((card) => {
          const amount = card.statement?.amountCents ?? 0;
          return (
            <div
              key={card.id}
              className="fin-strip-flows-card"
              title={[
                `${card.name}: fatura corrente`,
                card.flows.expenseCents !== 0 && `${debtFromCents(card.flows.expenseCents)} em compras no período`,
                card.statement &&
                  `fecha ${ledgerDate(card.statement.closingDate)} · vence ${ledgerDate(card.statement.dueDate)}`
              ]
                .filter(Boolean)
                .join("\n")}
            >
              <dt>
                <CreditCard size={11} aria-hidden />
                {card.name}
                {card.statement && <span> · vence {ledgerDate(card.statement.dueDate)}</span>}
              </dt>
              <dd className={amount > 0 ? "fin-negative" : ""}>{debtFromCents(amount)}</dd>
            </div>
          );
        })
      )}
      <div
        className="fin-strip-flows-earmark"
        title="Guardado nas caixinhas atreladas a esta conta, fora do saldo acima"
      >
        <dt>Em caixinhas</dt>
        <dd>{moneyFromCents(goalsCents)}</dd>
      </div>
    </dl>
  );
}
