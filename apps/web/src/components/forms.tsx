import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { parseCurrencyInput } from "@projeto41/finance";

/**
 * Campos de formulário que o `<input>` e o `<select>` nativos não resolvem
 * bem: dinheiro digitado já formatado, e listas com cor, busca e escolha
 * múltipla.
 */

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Centavos no formato que o campo mostra e que `parseCurrencyInput` lê. */
export function formatMoneyInput(cents: number): string {
  return `${cents < 0 ? "-" : ""}${brl.format(Math.abs(cents) / 100)}`;
}

/**
 * Valor em reais formatado enquanto se digita.
 *
 * Os dígitos entram pela direita, como na maquininha e no app do banco:
 * digitar 1, 2, 3, 4 mostra 0,01 → 0,12 → 1,23 → 12,34. Não existe estado
 * "meio digitado" que a tela não saiba formatar. O valor que sai continua
 * sendo texto em pt-BR ("1.234,56"), o mesmo que os formulários já parseiam.
 */
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  placeholder = "0,00",
  autoFocus,
  required,
  id,
  "aria-label": ariaLabel
}: {
  value: string;
  onChange: (next: string) => void;
  /** Saldo inicial pode ser negativo; um gasto, não — o sinal vem do tipo. */
  allowNegative?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const cents = value.trim() === "" ? null : parseCurrencyInput(value);
  const display = cents == null ? "" : formatMoneyInput(cents);
  const negative = (cents ?? 0) < 0;

  function handle(raw: string) {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (!digits) {
      onChange("");
      return;
    }
    // Um "-" digitado em qualquer lugar vira o sinal; digitar de novo tira.
    const minusTyped = allowNegative && (raw.match(/-/g)?.length ?? 0) % 2 === 1;
    const sign = allowNegative && minusTyped ? -1 : 1;
    onChange(formatMoneyInput(sign * Number(digits.slice(-13))));
  }

  return (
    <span className={`money-input ${negative ? "negative" : ""}`}>
      <span className="money-input-prefix" aria-hidden>
        R$
      </span>
      <input
        id={id}
        value={display}
        onChange={(event) => handle(event.target.value)}
        inputMode={allowNegative ? "text" : "numeric"}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        aria-label={ariaLabel}
        onFocus={(event) => {
          // O cursor fica sempre no fim: os dígitos entram pela direita.
          const input = event.target;
          requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
        }}
      />
    </span>
  );
}

export type DropdownOption<T extends string | number> = {
  value: T;
  label: string;
  /** Bolinha de cor à esquerda: categoria, conta, pessoa. */
  color?: string | null;
  hint?: string;
  icon?: ReactNode;
};

type DropdownBase<T extends string | number> = {
  options: DropdownOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  /** Busca aparece sozinha quando a lista passa disso. */
  searchThreshold?: number;
  "aria-label"?: string;
  id?: string;
};

type SingleProps<T extends string | number> = DropdownBase<T> & {
  multiple?: false;
  value: T | null;
  onChange: (next: T | null) => void;
  /** Rótulo da opção "nenhum"; sem ele, não dá para limpar. */
  emptyLabel?: string;
};

type MultiProps<T extends string | number> = DropdownBase<T> & {
  multiple: true;
  value: T[];
  onChange: (next: T[]) => void;
};

/**
 * Lista suspensa do app.
 *
 * O `<select>` nativo não mostra cor, não busca e abre com a cara do sistema
 * operacional — no tema escuro, uma lista branca no meio do drawer. Este abre
 * um painel no estilo do resto, com teclado (setas, Enter, Esc) e, na escolha
 * múltipla, mostra o escolhido como etiquetas no próprio campo.
 */
export function Dropdown<T extends string | number>(props: SingleProps<T> | MultiProps<T>) {
  const { options, placeholder = "Escolher", disabled, searchThreshold = 8 } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const listId = useId();
  const showSearch = options.length > searchThreshold;

  const selected = props.multiple ? props.value : props.value == null ? [] : [props.value];
  const emptyOption: DropdownOption<T> | null =
    !props.multiple && props.emptyLabel != null
      ? ({ value: "" as T, label: props.emptyLabel } as DropdownOption<T>)
      : null;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;
    return emptyOption && !needle ? [emptyOption, ...filtered] : filtered;
  }, [options, query, emptyOption]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  /**
   * A lista vive fora da gaveta (portal): dentro dela, o `overflow` do corpo
   * cortava as opções e obrigava a rolar o formulário. Ela abre para baixo ou
   * para cima, o que tiver mais espaço, e encolhe até caber na janela.
   */
  const rows = visible.length;
  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return;
    }
    function place() {
      const trigger = root.current?.getBoundingClientRect();
      if (!trigger) return;
      const margin = 10;
      const gap = 6;
      const wanted = Math.min(264, rows * 40 + 10) + (showSearch ? 46 : 0) + 4;
      const below = window.innerHeight - trigger.bottom - gap - margin;
      const above = trigger.top - gap - margin;
      const up = below < wanted && above > below;
      const width = Math.min(Math.max(trigger.width, 200), window.innerWidth - margin * 2);
      const left = Math.min(Math.max(trigger.left, margin), window.innerWidth - width - margin);
      setPanelStyle({
        left,
        width,
        maxHeight: Math.max(up ? above : below, 120),
        ...(up ? { bottom: window.innerHeight - trigger.top + gap } : { top: trigger.bottom + gap })
      });
    }
    place();
    // Rolar a gaveta ou redimensionar a janela mexe o campo: a lista o segue.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, rows, showSearch]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const index = visible.findIndex((option) => selected.includes(option.value));
      setCursor(Math.max(index, 0));
    }
    // Só ao abrir: recalcular a cada tecla levaria o cursor de volta ao topo.
  }, [open]);

  function pick(option: DropdownOption<T>) {
    if (props.multiple) {
      const has = props.value.includes(option.value);
      props.onChange(has ? props.value.filter((item) => item !== option.value) : [...props.value, option.value]);
      return;
    }
    props.onChange(option === emptyOption ? null : option.value);
    setOpen(false);
  }

  function onKey(event: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[cursor];
      if (option) pick(option);
    }
  }

  const chosen = options.filter((option) => selected.includes(option.value));

  return (
    <div
      ref={root}
      className={`dropdown ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
      onKeyDown={onKey}
    >
      <button
        type="button"
        id={props.id}
        className="dropdown-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={props["aria-label"]}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="dropdown-value">
          {chosen.length === 0 ? (
            <span className="dropdown-placeholder">
              {!props.multiple && props.emptyLabel != null ? props.emptyLabel : placeholder}
            </span>
          ) : props.multiple ? (
            chosen.map((option) => (
              <span
                key={option.value}
                className="dropdown-chip"
                style={{ borderColor: option.color ?? undefined }}
              >
                {option.color && <i style={{ background: option.color }} />}
                {option.label}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Tirar ${option.label}`}
                  className="dropdown-chip-x"
                  onClick={(event) => {
                    event.stopPropagation();
                    pick(option);
                  }}
                >
                  <X size={11} />
                </span>
              </span>
            ))
          ) : (
            <OptionLabel option={chosen[0]!} />
          )}
        </span>
        <ChevronDown size={16} className="dropdown-chevron" aria-hidden />
      </button>

      {open &&
        panelStyle &&
        createPortal(
        // O Field e um <label>, e clicar em algo dentro de um label repassa o
        // clique ao primeiro controle dele: o botao deste dropdown. Sem cancelar
        // esse repasse, escolher uma opcao fechava a lista e o botao a abria de
        // novo na mesma hora.
        <div
          ref={panelRef}
          className="dropdown-panel"
          style={panelStyle}
          onClick={(event) => event.preventDefault()}
        >
          {showSearch && (
            <label className="dropdown-search">
              <Search size={14} aria-hidden />
              <input
                autoFocus
                value={query}
                placeholder="Buscar"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCursor(0);
                }}
              />
            </label>
          )}
          <ul role="listbox" id={listId} aria-multiselectable={props.multiple || undefined}>
            {visible.length === 0 && <li className="dropdown-empty">Nada encontrado</li>}
            {visible.map((option, index) => {
              const active =
                option === emptyOption ? selected.length === 0 : selected.includes(option.value);
              return (
                <li
                  key={`${option.value}`}
                  role="option"
                  aria-selected={active}
                  className={`${index === cursor ? "cursor" : ""} ${active ? "active" : ""}`}
                  onMouseEnter={() => setCursor(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option)}
                >
                  {props.multiple && (
                    <span className={`dropdown-box ${active ? "on" : ""}`} aria-hidden>
                      {active && <Check size={11} />}
                    </span>
                  )}
                  <OptionLabel option={option} />
                  {!props.multiple && active && <Check size={14} className="dropdown-tick" aria-hidden />}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}

function OptionLabel<T extends string | number>({ option }: { option: DropdownOption<T> }) {
  return (
    <span className="dropdown-option">
      {option.icon}
      {option.color && <i className="dropdown-dot" style={{ background: option.color }} />}
      <span className="dropdown-option-text">
        <span>{option.label}</span>
        {option.hint && <small>{option.hint}</small>}
      </span>
    </span>
  );
}

/** Liga/desliga com rótulo e explicação, no lugar do checkbox cru. */
export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
