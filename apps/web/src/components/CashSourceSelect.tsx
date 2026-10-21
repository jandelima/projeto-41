import { Field } from "./ui.js";
import { currency, money, moneyFromCents } from "../lib/format.js";
import { POSITION_CATEGORY_LABEL, useInvestmentCash } from "../lib/cash.js";

/** De onde sai o dinheiro de uma operação: um caixa, uma conta, ou nada. */
export type CashSource = { positionId: number | null; accountId: number | null };

const encode = (source: CashSource) =>
  source.positionId != null ? `p:${source.positionId}` : source.accountId != null ? `a:${source.accountId}` : "";

const decode = (value: string): CashSource => {
  const [kind, id] = value.split(":");
  if (kind === "p") return { positionId: Number(id), accountId: null };
  if (kind === "a") return { positionId: null, accountId: Number(id) };
  return { positionId: null, accountId: null };
};

/**
 * De onde sai o dinheiro de uma compra (ou para onde vai o de uma venda).
 *
 * 1. **Um caixa** — uma posição de "Caixa e renda fixa" (Caixa BR, Dólar,
 *    Reserva). É o caminho natural: aporta uma vez, aloca aos poucos.
 * 2. **Uma conta bancária** — o banco paga direto, sem passar por caixa.
 * 3. **Não movimentar** — a operação vira só registro.
 *
 * A linha de baixo diz o que vai acontecer antes de salvar.
 */
export function CashSourceSelect({
  type,
  value,
  onChange,
  amountBrl,
  conversion
}: {
  type: "buy" | "sell";
  value: CashSource;
  onChange: (value: CashSource) => void;
  /** Valor da operação em BRL, para dizer se o caixa cobre. */
  amountBrl: number;
  /** Detalhe da conversão de moeda, quando há. */
  conversion?: string;
}) {
  const { caixas, banks } = useInvestmentCash();
  const buying = type === "buy";
  const caixa = caixas.find((position) => position.id === value.positionId) ?? null;
  const bank = banks.find((account) => account.id === value.accountId) ?? null;

  let hint: string;
  let tone = "";
  if (caixa) {
    // Caixa em dólar mostra o saldo em dólar; o aviso de "não cobre" só se
    // calcula com certeza em reais, então fica para o servidor nesse caso.
    const after = caixa.currentValue + (buying ? -amountBrl : amountBrl);
    if (caixa.currency === "BRL" && buying && after < -0.005) {
      tone = "fin-negative";
      hint = `${caixa.name} tem ${money(caixa.currentValue)}: faltam ${money(-after)}. Aporte antes ou pague pela conta.`;
    } else if (caixa.currency === "BRL") {
      hint = buying
        ? `Sai de ${caixa.name}. Ficam ${money(after)} nele.`
        : `Entra em ${caixa.name} para realocar: ${money(after)} depois da venda.`;
    } else {
      hint = buying ? `Sai de ${caixa.name}, convertido pela cotação.` : `Entra em ${caixa.name}, convertido pela cotação.`;
    }
  } else if (bank) {
    hint = buying
      ? `${money(amountBrl)} sai direto de ${bank.name}.`
      : `${money(amountBrl)} volta direto para ${bank.name}.`;
  } else {
    hint = "Só registra a operação: nenhum dinheiro é movimentado.";
  }

  return (
    <Field
      label={buying ? "Pagar com" : "Receber em"}
      hint={
        <span className={tone}>
          {hint}
          {conversion && (caixa || bank) ? ` · ${conversion}` : ""}
        </span>
      }
    >
      <select value={encode(value)} onChange={(event) => onChange(decode(event.target.value))}>
        {caixas.length > 0 && (
          <optgroup label="Caixas de investimento">
            {caixas.map((position) => (
              <option key={position.id} value={`p:${position.id}`}>
                {position.name} ({POSITION_CATEGORY_LABEL[position.category] ?? position.category}) ·{" "}
                {currency(position.currentValue, position.currency)}
              </option>
            ))}
          </optgroup>
        )}
        {banks.length > 0 && (
          <optgroup label={buying ? "Direto da conta" : "Direto para a conta"}>
            {banks.map((account) => (
              <option key={account.id} value={`a:${account.id}`}>
                {account.name} · {moneyFromCents(account.currentBalanceCents)}
              </option>
            ))}
          </optgroup>
        )}
        <option value="">Não movimentar dinheiro</option>
      </select>
    </Field>
  );
}
