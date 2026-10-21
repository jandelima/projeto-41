import type { InvestmentAccount } from "@projeto41/contracts";
import { Dropdown } from "./forms.js";

/**
 * Seletor da conta do módulo de investimentos, no menu lateral.
 *
 * As contas são as pessoas do módulo de finanças (Steylor, Bianca…): cada uma
 * tem os próprios registros — operações, caixas e renda fixa, aportes, metas
 * de alocação, planejamento e histórico. Trocar de pessoa troca tudo de uma
 * vez. Pessoa nova se cadastra em Finanças › Contas e pessoas.
 */
export function InvestmentAccountSwitch({
  accounts,
  value,
  onChange
}: {
  accounts: InvestmentAccount[];
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <div className="account-switch">
      <span className="nav-group-label">Investimentos de</span>
      <Dropdown<number>
        value={value}
        onChange={(next) => next != null && onChange(next)}
        options={accounts.map((account) => ({ value: account.id, label: account.name }))}
        aria-label="Conta de investimento"
      />
    </div>
  );
}
