import { Filter, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { EntryFilter } from "@projeto41/contracts";
import { DateField } from "../datepicker.js";
import { Field, SearchInput, Segmented } from "../ui.js";
import type { LedgerReference } from "../../lib/ledger.js";
import { STATUS_LABEL } from "../../lib/ledger.js";
import {
  PeriodStepper,
  monthPeriod,
  periodLabel,
  shiftPeriod,
  yearPeriod,
  type SelectedPeriod
} from "./PeriodPicker.js";

export type LedgerFilter = Partial<EntryFilter>;

type KindOption = "all" | "expense" | "income" | "transfer";

/** O filtro de datas lido como período: um mês inteiro, um ano inteiro, tudo ou outro. */
function periodOf(filter: LedgerFilter): SelectedPeriod | "all" | null {
  if (!filter.from && !filter.to) return "all";
  if (!filter.from || !filter.to) return null;
  const anchor = new Date(`${filter.from}T12:00:00`);
  const month = monthPeriod(0, anchor);
  if (month.from === filter.from && month.to === filter.to) return month;
  const year = yearPeriod(anchor);
  if (year.from === filter.from && year.to === filter.to) return year;
  return null;
}

export function EntryFilters({
  filter,
  onChange,
  reference,
  lockedKind = false
}: {
  filter: LedgerFilter;
  onChange: (next: LedgerFilter) => void;
  reference: LedgerReference;
  /** Gastos e Entradas fixam o tipo; Transações deixa escolher. */
  lockedKind?: boolean;
}) {
  // Qualquer mudança volta para a página 1: manter a página com outro filtro
  // aplicado mostra "nenhum resultado" numa busca que tem resultados.
  const patch = (next: LedgerFilter) => onChange({ ...filter, ...next, page: 1 });

  const period = periodOf(filter);
  const chips = buildChips(filter, reference);
  // Os filtros finos ficam recolhidos: período, tipo e busca resolvem quase
  // tudo, e nove selects abertos empurravam a lista para fora da tela.
  const refined = chips.filter((chip) => chip.key !== "search").length;
  // Um intervalo que não é atalho (vindo do Painel, por exemplo) só se vê nas
  // datas: nesse caso os filtros já abrem.
  const [open, setOpen] = useState(period == null);
  const today = monthPeriod(0);
  const mode = period === "all" ? "all" : period == null ? "custom" : period.mode;
  const setPeriod = (next: SelectedPeriod | "all") =>
    patch(next === "all" ? { from: undefined, to: undefined } : { from: next.from, to: next.to });

  return (
    <div className="fin-filters">
      <div className="fin-filter-row">
        <div className="fin-period-row">
          {period && period !== "all" ? (
            <PeriodStepper
              label={periodLabel(period)}
              onPrevious={() => setPeriod(shiftPeriod(period, -1))}
              onNext={() => setPeriod(shiftPeriod(period, 1))}
              onToday={() => setPeriod(period.mode === "year" ? yearPeriod() : today)}
              isToday={
                period.mode === "year"
                  ? period.year === new Date().getFullYear()
                  : period.period === today.period
              }
            />
          ) : (
            <span className="period-custom-label">
              {period === "all" ? "Todo o histórico" : `${filter.from ?? "…"} a ${filter.to ?? "…"}`}
            </span>
          )}
          <div className="period-modes" role="group" aria-label="Tamanho do período">
            {(
              [
                ["month", "Mês"],
                ["year", "Ano"],
                ["all", "Tudo"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={mode === value ? "active" : ""}
                onClick={() => {
                  const anchor = filter.from ? new Date(`${filter.from}T12:00:00`) : new Date();
                  if (value === "month") setPeriod(monthPeriod(0, anchor));
                  else if (value === "year") setPeriod(yearPeriod(anchor));
                  else setPeriod("all");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!lockedKind && (
          <Segmented<KindOption>
            value={filter.kind && filter.kind !== "adjustment" ? filter.kind : "all"}
            onChange={(value) =>
              patch({ kind: value === "all" ? undefined : (value as EntryFilter["kind"]) })
            }
            options={[
              { value: "all", label: "Tudo" },
              { value: "expense", label: "Saídas" },
              { value: "income", label: "Entradas" },
              { value: "transfer", label: "Transferências" }
            ]}
          />
        )}
        <div className="fin-filter-search">
          <SearchInput
            value={filter.search ?? ""}
            onChange={(value) => patch({ search: value || undefined })}
            placeholder="Buscar descrição ou local"
          />
          <button
            type="button"
            className={`fin-filter-toggle ${open ? "active" : ""}`}
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
          >
            <SlidersHorizontal size={15} aria-hidden />
            Filtros
            {refined > 0 && <span className="fin-filter-count">{refined}</span>}
          </button>
        </div>
      </div>

      {open && (
        <div className="fin-filter-grid">
          <Field label="De">
            <DateField value={filter.from ?? ""} onChange={(value) => patch({ from: value || undefined })} />
          </Field>
          <Field label="Até">
            <DateField value={filter.to ?? ""} onChange={(value) => patch({ to: value || undefined })} />
          </Field>
          <Field label="Conta">
            <select
              value={filter.accountId ?? ""}
              onChange={(event) =>
                patch({ accountId: event.target.value ? Number(event.target.value) : undefined })
              }
            >
              <option value="">Todas</option>
              {reference.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pessoa">
            <select
              value={filter.personId ?? ""}
              onChange={(event) =>
                patch({ personId: event.target.value ? Number(event.target.value) : undefined })
              }
            >
              <option value="">Todas</option>
              {reference.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoria">
            <select
              value={filter.categoryId?.[0] ?? ""}
              onChange={(event) =>
                patch({ categoryId: event.target.value ? [Number(event.target.value)] : undefined })
              }
            >
              <option value="">Todas</option>
              {reference.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Etiqueta">
            <select
              value={filter.tagId?.[0] ?? ""}
              onChange={(event) =>
                patch({ tagId: event.target.value ? [Number(event.target.value)] : undefined })
              }
            >
              <option value="">Todas</option>
              {reference.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Caixinha">
            <select
              value={filter.goalId ?? ""}
              onChange={(event) =>
                patch({ goalId: event.target.value ? Number(event.target.value) : undefined })
              }
            >
              <option value="">Todas</option>
              {reference.goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={filter.status ?? ""}
              onChange={(event) =>
                patch({ status: (event.target.value || undefined) as EntryFilter["status"] })
              }
            >
              <option value="">Todos</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {chips.length > 0 && (
        <div className="fin-chips">
          <Filter size={13} aria-hidden />
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => patch(chip.clear)}>
              {chip.label}
              <X size={12} />
            </button>
          ))}
          <button
            type="button"
            className="fin-chip-clear"
            onClick={() => onChange({ page: 1, pageSize: filter.pageSize })}
          >
            Limpar tudo
          </button>
        </div>
      )}
    </div>
  );
}

/** O filtro aplicado precisa ser visível e removível item a item. */
function buildChips(filter: LedgerFilter, reference: LedgerReference) {
  const chips: { key: string; label: string; clear: LedgerFilter }[] = [];
  const name = <T extends { id: number; name: string }>(list: T[], id?: number) =>
    list.find((item) => item.id === id)?.name;

  if (filter.accountId) {
    chips.push({
      key: "account",
      label: `Conta: ${name(reference.accounts, filter.accountId) ?? filter.accountId}`,
      clear: { accountId: undefined }
    });
  }
  if (filter.personId) {
    chips.push({
      key: "person",
      label: `Pessoa: ${name(reference.people, filter.personId) ?? filter.personId}`,
      clear: { personId: undefined }
    });
  }
  if (filter.categoryId?.length) {
    chips.push({
      key: "category",
      label: `Categoria: ${name(reference.categories, filter.categoryId[0]) ?? ""}`,
      clear: { categoryId: undefined }
    });
  }
  if (filter.tagId?.length) {
    chips.push({
      key: "tag",
      label: `Etiqueta: ${name(reference.tags, filter.tagId[0]) ?? ""}`,
      clear: { tagId: undefined }
    });
  }
  if (filter.status) {
    chips.push({
      key: "status",
      label: `Status: ${STATUS_LABEL[filter.status]}`,
      clear: { status: undefined }
    });
  }
  if (filter.goalId) {
    chips.push({
      key: "goal",
      label: `Caixinha: ${name(reference.goals, filter.goalId) ?? ""}`,
      clear: { goalId: undefined }
    });
  }
  if (filter.installmentPlanId) {
    chips.push({
      key: "plan",
      label: "Compra parcelada",
      clear: { installmentPlanId: undefined }
    });
  }
  if (filter.statementMonth) {
    chips.push({
      key: "statement",
      label: `Fatura de ${filter.statementMonth}`,
      clear: { statementMonth: undefined }
    });
  }
  if (filter.search) {
    chips.push({ key: "search", label: `Busca: ${filter.search}`, clear: { search: undefined } });
  }
  return chips;
}
