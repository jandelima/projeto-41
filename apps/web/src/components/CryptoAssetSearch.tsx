import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "../lib/api.js";
import { portfolioIconUrl } from "../lib/icons.js";
import type { CryptoSearchResult } from "../lib/types.js";
import { AssetIcon, IconButton } from "./ui.js";

export function CryptoAssetSearch({
  selected,
  onSelect,
  onClear,
  autoFocus
}: {
  selected: { symbol: string; name: string } | null;
  onSelect: (result: CryptoSearchResult) => void;
  onClear: () => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CryptoSearchResult[]>([]);
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
      api<CryptoSearchResult[]>(`/crypto/search?q=${encodeURIComponent(term)}`)
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
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  if (selected) {
    return (
      <div className="crypto-pick">
        <AssetIcon src={portfolioIconUrl("crypto", selected.symbol)} label={selected.symbol} />
        <div className="crypto-pick-text">
          <strong>{selected.symbol}</strong>
          <small>{selected.name}</small>
        </div>
        <IconButton icon={X} label="Trocar ativo" onClick={onClear} />
      </div>
    );
  }

  function choose(result: CryptoSearchResult) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || !results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = results[active];
      if (hit) choose(hit);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="crypto-search">
      <div className="search-input crypto-search-input">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Buscar símbolo ou nome (BTC, bitcoin…)"
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
            <li key={result.id}>
              <button
                type="button"
                className={index === active ? "active" : ""}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(result)}
              >
                <AssetIcon src={portfolioIconUrl("crypto", result.symbol)} label={result.symbol} />
                <span className="crypto-sym">{result.symbol}</span>
                <span className="crypto-name">{result.name}</span>
                {result.rank != null && <span className="crypto-rank">#{result.rank}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
