import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "../lib/api.js";
import { money } from "../lib/format.js";
import { b3IconUrl } from "../lib/icons.js";
import type { B3SearchResult } from "../lib/types.js";
import { AssetIcon, IconButton } from "./ui.js";

export function B3AssetSearch({
  selected,
  onSelect,
  onClear,
  autoFocus
}: {
  selected: { symbol: string; name: string } | null;
  onSelect: (result: B3SearchResult) => void;
  onClear: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<B3SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      api<B3SearchResult[]>(`/b3/search?q=${encodeURIComponent(term)}`)
        .then((hits) => {
          if (cancelled) return;
          setResults(hits);
          setActive(0);
          setOpen(true);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  if (selected) {
    return (
      <div className="crypto-pick">
        <AssetIcon src={b3IconUrl(selected.symbol)} label={selected.symbol} />
        <span className="crypto-pick-sym">{selected.symbol}</span>
        <span className="crypto-pick-name">{selected.name}</span>
        <IconButton icon={X} label="Trocar ativo" onClick={onClear} />
      </div>
    );
  }

  function choose(result: B3SearchResult) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  // Aceita o ticker digitado à mão quando a brapi não retorna correspondência
  // (mantém o fluxo antigo: preço/ícone só chegam se o ativo existir na busca).
  function chooseRaw() {
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;
    choose({ symbol, name: symbol, price: 0, currency: "BRL" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = open && results.length ? results[active] : undefined;
      if (hit) choose(hit);
      else chooseRaw();
      return;
    }
    if (!open || !results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="crypto-search">
      <div className="crypto-search-input">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value.toUpperCase())}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Buscar ticker ou empresa (PETR4, Vale…)"
          autoFocus={autoFocus}
        />
      </div>
      {open && (
        <ul className="crypto-results">
          {loading && <li className="crypto-empty">Buscando…</li>}
          {!loading && results.length === 0 && (
            <li className="crypto-empty">Nenhum ativo encontrado</li>
          )}
          {results.map((result, index) => (
            <li key={result.symbol}>
              <button
                type="button"
                className={index === active ? "active" : ""}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(result)}
              >
                <AssetIcon src={b3IconUrl(result.symbol)} label={result.symbol} />
                <span className="crypto-sym">{result.symbol}</span>
                <span className="crypto-name">{result.name}</span>
                {result.price > 0 && <span className="crypto-rank">{money(result.price)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
