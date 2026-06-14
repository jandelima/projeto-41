import { CalendarDays, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Drawer, useConfirm } from "../components/dialog.js";
import {
  Button,
  Empty,
  Field,
  IconButton,
  MiniStat,
  NumberInput,
  Panel,
  SectionHeading
} from "../components/ui.js";
import { api } from "../lib/api.js";
import { longDate, money, monthShort } from "../lib/format.js";
import { useToast } from "../lib/toast.js";
import type { Contribution } from "../lib/types.js";

export function ContributionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Contribution[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => api<Contribution[]>("/contributions").then(setItems), []);
  useEffect(() => void load(), [load]);

  const year = new Date().getFullYear();
  const yearItems = items.filter((item) => Number(item.date.slice(0, 4)) === year);
  const total = yearItems.reduce((sum, item) => sum + item.amount, 0);

  const monthly = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        month: monthShort[index],
        value: yearItems
          .filter((item) => Number(item.date.slice(5, 7)) === index + 1)
          .reduce((sum, item) => sum + item.amount, 0)
      })),
    [yearItems]
  );
  const max = Math.max(...monthly.map((m) => m.value), 1);
  const activeMonths = monthly.filter((m) => m.value > 0).length;
  const bestMonth = monthly.reduce((best, m) => (m.value > best.value ? m : best), {
    month: "—",
    value: 0
  });

  async function remove(item: Contribution) {
    const ok = await confirm({
      title: "Excluir aporte",
      message: `Remover aporte de ${money(item.amount)} em ${longDate(item.date)}?`,
      tone: "danger",
      confirmLabel: "Excluir"
    });
    if (!ok) return;
    await api(`/contributions/${item.id}`, { method: "DELETE" });
    await load();
    toast.notify("Aporte excluído");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api("/contributions", {
        method: "POST",
        body: JSON.stringify({
          date: form.get("date"),
          amount: Number(form.get("amount")),
          notes: String(form.get("notes") ?? "")
        })
      });
      setOpen(false);
      await load();
      toast.notify("Aporte registrado");
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao registrar", "error");
    }
  }

  return (
    <div className="contributions">
      <SectionHeading title="Aportes" subtitle={`Acompanhamento mensal de ${year}`}>
        <Button icon={Plus} onClick={() => setOpen(true)}>
          Registrar aporte
        </Button>
      </SectionHeading>

      <div className="summary-row">
        <MiniStat label="Total no ano" value={money(total)} />
        <MiniStat label="Média por mês ativo" value={money(activeMonths ? total / activeMonths : 0)} />
        <MiniStat label="Melhor mês" value={`${bestMonth.month} · ${money(bestMonth.value)}`} />
        <MiniStat label="Lançamentos" value={String(yearItems.length)} />
      </div>

      <Panel title="Aportes por mês" subtitle={`Ano de ${year}`}>
        <div className="month-bars">
          {monthly.map((month) => (
            <div key={month.month} className="month-bar">
              <strong>{month.value ? money(month.value) : ""}</strong>
              <i style={{ height: `${month.value ? Math.max(6, (month.value / max) * 150) : 2}px` }} className={month.value ? "" : "empty-bar"} />
              <span>{month.month}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Lançamentos" subtitle="Mais recentes primeiro">
        <div className="table-scroll compact">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th className="right">Valor</th>
                <th>Observação</th>
                <th className="right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {[...items].reverse().map((item) => (
                <tr key={item.id}>
                  <td>{longDate(item.date)}</td>
                  <td className="right num">
                    <strong>{money(item.amount)}</strong>
                  </td>
                  <td className="muted">{item.notes || "—"}</td>
                  <td className="right">
                    <IconButton icon={Trash2} label="Excluir" tone="danger" onClick={() => remove(item)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <Empty icon={CalendarDays} text="Nenhum aporte registrado." />}
        </div>
      </Panel>

      {open && (
        <Drawer
          title="Registrar aporte"
          subtitle="Some ao acompanhamento do ano"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button icon={Save} type="submit" form="contribution-form">
                Salvar
              </Button>
            </>
          }
        >
          <form id="contribution-form" className="stack" onSubmit={submit}>
            <Field label="Data">
              <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Valor (BRL)">
              <NumberInput name="amount" min="0" required autoFocus placeholder="0,00" />
            </Field>
            <Field label="Observação">
              <input name="notes" placeholder="Opcional" />
            </Field>
          </form>
        </Drawer>
      )}
    </div>
  );
}
