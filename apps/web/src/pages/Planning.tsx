import { Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DualAreaTrend } from "../components/charts.js";
import { Button, Field, Loading, MiniStat, NumberInput, Panel, SectionHeading } from "../components/ui.js";
import { api } from "../lib/api.js";
import { money } from "../lib/format.js";
import { useToast } from "../lib/toast.js";
import type { PlanningForm } from "../lib/types.js";

const fields: { key: keyof PlanningForm; label: string; suffix: string }[] = [
  { key: "initialCapital", label: "Capital inicial", suffix: "R$" },
  { key: "monthlyContribution", label: "Aporte mensal", suffix: "R$" },
  { key: "monthlyReturnPercent", label: "Rendimento mensal", suffix: "%" },
  { key: "months", label: "Período", suffix: "meses" },
  { key: "annualInflationPercent", label: "Inflação anual", suffix: "%" },
  { key: "initialYear", label: "Ano inicial", suffix: "" }
];

export function PlanningPage() {
  const toast = useToast();
  const [form, setForm] = useState<PlanningForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<PlanningForm>("/planning").then((data) =>
      setForm({ ...data, initialYear: data.initialYear || new Date().getFullYear() })
    );
  }, []);

  const projection = useMemo(() => {
    if (!form) return [];
    const years = Math.max(0, Math.round(Number(form.months) / 12));
    const rate = Number(form.monthlyReturnPercent) / 100;
    const inflation = Number(form.annualInflationPercent) / 100;
    let nominal = Number(form.initialCapital);
    const rows = [];
    for (let year = 1; year <= years; year += 1) {
      const contribution = Number(form.monthlyContribution) * (1 + inflation) ** (year - 1);
      for (let month = 0; month < 12; month += 1) nominal = nominal * (1 + rate) + contribution;
      const real = nominal / (1 + inflation) ** year;
      rows.push({
        year: Number(form.initialYear) + year,
        nominal,
        real,
        contribution: contribution * 12,
        monthlyIncome: real * rate
      });
    }
    return rows;
  }, [form]);

  if (!form) return <Loading />;

  const last = projection.at(-1);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api("/planning", {
        method: "PUT",
        body: JSON.stringify(
          Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Number(value)]))
        )
      });
      toast.notify("Parâmetros salvos");
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="planning">
      <SectionHeading title="Simulador patrimonial" subtitle="Projeção de aportes, rendimento e inflação">
        <Button icon={Save} onClick={save} disabled={saving}>
          {saving ? "Salvando…" : "Salvar parâmetros"}
        </Button>
      </SectionHeading>

      <div className="planning-layout">
        <Panel title="Parâmetros" subtitle="Ajuste o cenário" className="planning-params">
          <div className="stack">
            {fields.map((item) => (
              <Field key={item.key} label={item.label}>
                <div className="input-suffix">
                  <NumberInput
                    value={form[item.key]}
                    onChange={(event) => setForm({ ...form, [item.key]: Number(event.target.value) })}
                  />
                  {item.suffix && <span>{item.suffix}</span>}
                </div>
              </Field>
            ))}
          </div>
        </Panel>

        <div className="planning-main">
          <div className="summary-row">
            <MiniStat label="Saldo nominal final" value={money(last?.nominal ?? 0)} />
            <MiniStat label="Saldo corrigido final" value={money(last?.real ?? 0)} tone="positive-text" />
            <MiniStat label="Renda mensal estimada" value={money(last?.monthlyIncome ?? 0)} />
          </div>
          <Panel title="Projeção" subtitle={`${projection.length} anos`}>
            {projection.length ? (
              <DualAreaTrend data={projection} height={320} />
            ) : (
              <p className="muted-note">Defina um período para ver a projeção.</p>
            )}
            <div className="chart-legend">
              <span><i className="dot-accent" /> Saldo nominal</span>
              <span><i className="dot-positive" /> Saldo corrigido pela inflação</span>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Evolução ano a ano" subtitle="Saldo projetado por ano">
        <div className="table-scroll compact">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ano</th>
                <th className="right">Aporte no ano</th>
                <th className="right">Saldo nominal</th>
                <th className="right">Saldo corrigido</th>
                <th className="right">Renda mensal (corrigida)</th>
              </tr>
            </thead>
            <tbody>
              {projection.map((row) => (
                <tr key={row.year}>
                  <td>
                    <strong>{row.year}</strong>
                  </td>
                  <td className="right num">{money(row.contribution)}</td>
                  <td className="right num">{money(row.nominal)}</td>
                  <td className="right num">{money(row.real)}</td>
                  <td className="right num positive-text">{money(row.monthlyIncome)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
