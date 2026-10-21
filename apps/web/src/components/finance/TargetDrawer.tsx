import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AccountRecord, EntryListResult, SplitMode, TargetReport } from "@projeto41/contracts";
import { computeCoupleSplit, computeTargets, parseCurrencyInput } from "@projeto41/finance";
import { Drawer } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../forms.js";
import { CoupleSplitPanel } from "./CoupleSplitPanel.js";

/** Último dia do mês `YYYY-MM`. */
function monthEnd(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const day = new Date(year ?? 2000, month ?? 1, 0).getDate();
  return `${period}-${String(day).padStart(2, "0")}`;
}

/**
 * O que já entrou nas contas do casal no mês, por pessoa. Transferência conta
 * para o dono da conta de origem; entrada direta não é de ninguém em particular.
 */
async function jointDeposits(
  period: string,
  jointPersonId: number
): Promise<{ byPerson: Map<number, number>; unattributedCents: number }> {
  const accounts = await api<AccountRecord[]>("/ledger/accounts");
  const ownerOf = new Map(accounts.map((account) => [account.id, account.personId]));
  const joint = accounts.filter(
    (account) =>
      account.personId === jointPersonId &&
      !["credit_card", "goal", "investment"].includes(account.kind)
  );
  const byPerson = new Map<number, number>();
  let unattributedCents = 0;
  for (const account of joint) {
    const list = await api<EntryListResult>(
      `/ledger/entries?accountId=${account.id}&from=${period}-01&to=${monthEnd(period)}` +
        "&includeTransfers=1&pageSize=500"
    );
    for (const entry of list.rows) {
      if (entry.amountCents <= 0 || (entry.kind !== "income" && entry.kind !== "transfer")) continue;
      const from =
        entry.kind === "transfer" && entry.counterpartAccountId != null
          ? ownerOf.get(entry.counterpartAccountId) ?? null
          : entry.personId;
      // Dinheiro entre duas contas do casal não é depósito de ninguém.
      if (from === jointPersonId && entry.kind === "transfer") continue;
      if (from == null || from === jointPersonId) unattributedCents += entry.amountCents;
      else byPerson.set(from, (byPerson.get(from) ?? 0) + entry.amountCents);
    }
  }
  return { byPerson, unattributedCents };
}

/** Campo monetário opcional: vazio significa "não definido", não zero. */
function optionalCents(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  const cents = parseCurrencyInput(text);
  return cents == null ? "invalid" : cents;
}

export function TargetDrawer({
  report,
  onClose,
  onSaved
}: {
  report: TargetReport;
  onClose: () => void;
  onSaved: (next: TargetReport) => void;
}) {
  const toast = useToast();
  const [splitMode, setSplitMode] = useState<SplitMode>(report.splitMode);
  const [totalTarget, setTotalTarget] = useState(centsToInput(report.totalExpenseTargetCents));
  const [pooledIncome, setPooledIncome] = useState(centsToInput(report.pooledIncomeCents));
  const [jointTarget, setJointTarget] = useState(centsToInput(report.jointExpenseTargetCents));
  const [overrides, setOverrides] = useState(() =>
    Object.fromEntries(
      report.people.map((person) => [
        person.id,
        {
          income: centsToInput(person.incomeOverrideCents),
          target: centsToInput(person.targetOverrideCents)
        }
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  const jointPerson = report.people.find((person) => person.kind === "joint") ?? null;
  const [deposits, setDeposits] = useState<{
    byPerson: Map<number, number>;
    unattributedCents: number;
  } | null>(null);
  useEffect(() => {
    if (!jointPerson) return;
    let alive = true;
    void jointDeposits(report.period, jointPerson.id)
      .then((result) => alive && setDeposits(result))
      .catch(() => alive && setDeposits({ byPerson: new Map(), unattributedCents: 0 }));
    return () => {
      alive = false;
    };
  }, [report.period, jointPerson?.id]);

  // A mesma conta do servidor, com o que está digitado: a divisão muda enquanto
  // o casal mexe nos números, antes de salvar.
  const preview = useMemo(() => {
    const draftCents = (text: string) => {
      const value = optionalCents(text);
      return value === "invalid" ? null : value;
    };
    const incomeOverrides = Object.fromEntries(
      report.people.map((person) => [person.id, draftCents(overrides[person.id]?.income ?? "")])
    );
    const targetOverrides = Object.fromEntries(
      report.people.map((person) => [person.id, draftCents(overrides[person.id]?.target ?? "")])
    );
    const jointTargetCents = draftCents(jointTarget);
    const targets = computeTargets({
      splitMode,
      people: report.people.map((person) => ({ ...person, active: true })),
      incomeByPerson: Object.fromEntries(report.people.map((person) => [person.id, person.incomeCents])),
      realizedByPerson: {},
      incomeOverrides,
      targetOverrides,
      totalExpenseTargetCents: draftCents(totalTarget),
      pooledIncomeCents: draftCents(pooledIncome),
      jointExpenseTargetCents: jointTargetCents,
      // Sem teto digitado, o servidor usa a soma dos orçamentos de categoria:
      // é o total que ele devolveu quando o período não tinha teto próprio.
      categoryBudgetSumCents:
        report.splitMode !== "pooled" && report.totalExpenseTargetCents == null
          ? report.totalTargetCents
          : null
    });
    const targetOf = new Map(targets.bars.map((bar) => [bar.personId, bar.targetCents]));
    const split = computeCoupleSplit({
      splitMode,
      people: report.people
        .filter((person) => person.kind === "individual")
        .map((person) => ({
          id: person.id,
          name: person.name,
          color: person.color,
          incomeCents: incomeOverrides[person.id] ?? person.incomeCents,
          personalTargetCents: targetOf.get(person.id) ?? null
        })),
      jointTargetCents
    });
    const baseLabel =
      splitMode === "pooled"
        ? `Bolo comum: ${moneyFromCents(targets.totalTargetCents ?? 0)}`
        : `Contas do casal: ${moneyFromCents(jointTargetCents ?? 0)} de ${moneyFromCents(
            targets.totalTargetCents ?? 0
          )} do alvo total`;
    // Pela renda, o teto conjunto sai de dentro do alvo total. Maior que ele,
    // a parte pessoal de cada um ficaria negativa.
    const jointOverTotal =
      splitMode === "income_proportional" &&
      jointTargetCents != null &&
      targets.totalTargetCents != null &&
      jointTargetCents > targets.totalTargetCents
        ? `As contas da casa (${moneyFromCents(jointTargetCents)}) passam do alvo total (${moneyFromCents(
            targets.totalTargetCents
          )}). O alvo total é tudo que o casal pretende gastar, contas da casa incluídas: aumente o teto de gasto do período.`
        : null;
    return { split, baseLabel, jointOverTotal };
  }, [report, splitMode, totalTarget, pooledIncome, jointTarget, overrides]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const values = {
      totalExpenseTargetCents: optionalCents(totalTarget),
      pooledIncomeCents: optionalCents(pooledIncome),
      jointExpenseTargetCents: optionalCents(jointTarget)
    };
    if (Object.values(values).includes("invalid")) {
      toast.notify("Algum valor está inválido", "error");
      return;
    }

    setSaving(true);
    try {
      let result = await api<{ targets: TargetReport }>(`/ledger/targets/${report.period}`, {
        method: "PUT",
        body: JSON.stringify({ splitMode, ...values })
      });

      // Os overrides vão em chamadas próprias; a última resposta já traz o
      // agregado recalculado, então a tela não precisa reconsultar.
      for (const person of report.people) {
        const draft = overrides[person.id];
        if (!draft) continue;
        const income = optionalCents(draft.income);
        const target = optionalCents(draft.target);
        if (income === "invalid" || target === "invalid") continue;
        if (income === person.incomeOverrideCents && target === person.targetOverrideCents) continue;
        result = await api<{ targets: TargetReport }>(
          `/ledger/targets/${report.period}/people/${person.id}`,
          {
            method: "PUT",
            body: JSON.stringify({ incomeOverrideCents: income, targetOverrideCents: target })
          }
        );
      }

      toast.notify("Alvo do período salvo");
      onSaved(result.targets);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Alvo do período"
      subtitle="Quanto cada um deveria gastar neste mês"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="target-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="target-form" className="stack" onSubmit={submit}>
        <Segmented<SplitMode>
          value={splitMode}
          onChange={setSplitMode}
          options={[
            { value: "none", label: "Sem divisão" },
            { value: "income_proportional", label: "Pela renda" },
            { value: "pooled", label: "Bolo comum" }
          ]}
        />

        {splitMode !== "pooled" && (
          <Field
            label="Teto de gasto do período"
            hint="Tudo que o casal pretende gastar, contas da casa incluídas. Vazio usa a soma dos orçamentos de categoria."
          >
            <MoneyInput
              value={totalTarget}
              onChange={setTotalTarget}
              placeholder="Soma dos orçamentos"
            />
          </Field>
        )}

        {splitMode === "pooled" && (
          <div className="field-row">
            <Field label="Renda do bolo" hint="Vazio soma a renda de todos.">
              <MoneyInput
                value={pooledIncome}
                onChange={setPooledIncome}
                placeholder="0,00"
              />
            </Field>
            <Field label="Teto dos gastos conjuntos">
              <MoneyInput
                value={jointTarget}
                onChange={setJointTarget}
                placeholder="0,00"
              />
            </Field>
          </div>
        )}

        {splitMode === "income_proportional" && (
          <Field
            label="Teto dos gastos conjuntos"
            hint="As contas da casa, pagas pela conjunta. Cada um deposita a sua parte pela renda."
          >
            <MoneyInput
              value={jointTarget}
              onChange={setJointTarget}
              placeholder="Sem teto conjunto"
            />
          </Field>
        )}

        {splitMode !== "none" && (
          <CoupleSplitPanel
            warning={preview.jointOverTotal}
            split={preview.split}
            baseLabel={preview.baseLabel}
            deposited={jointPerson ? (deposits?.byPerson ?? null) : new Map()}
            unattributedCents={deposits?.unattributedCents ?? 0}
          />
        )}

        {splitMode !== "none" && (
          <div className="fin-override-list">
            <span className="field-label">Ajustes por pessoa</span>
            {report.people.map((person) => (
              <div key={person.id} className="fin-override">
                <span className="fin-inline">
                  <span className="fin-dot" style={{ background: person.color }} aria-hidden />
                  {person.name}
                </span>
                <div className="field-row">
                  <Field
                    label="Renda"
                    // Mostrar o apurado ao lado deixa claro o que está sendo
                    // sobrescrito, em vez de o usuário adivinhar.
                    hint={`Apurado: ${moneyFromCents(person.incomeCents)}`}
                  >
                    <input
                      value={overrides[person.id]?.income ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [person.id]: {
                            income: event.target.value,
                            target: current[person.id]?.target ?? ""
                          }
                        }))
                      }
                      inputMode="decimal"
                      placeholder="Usar o apurado"
                    />
                  </Field>
                  <Field label="Alvo" hint="Vence o cálculo proporcional.">
                    <input
                      value={overrides[person.id]?.target ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [person.id]: {
                            income: current[person.id]?.income ?? "",
                            target: event.target.value
                          }
                        }))
                      }
                      inputMode="decimal"
                      placeholder="Calcular"
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </form>
    </Drawer>
  );
}
