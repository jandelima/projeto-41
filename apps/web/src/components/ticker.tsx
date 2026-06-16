import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Modal } from "./dialog.js";
import { AssetIcon, Button } from "./ui.js";
import { currencyRaw, signedPercent } from "../lib/format.js";

export type TickerItem = {
  symbol: string;
  price: number;
  currency: string;
  change: number | null;
  icon?: string;
};

export type TickerCandidate = TickerItem & { portfolio: "crypto" | "b3" };

export function Ticker({ items, onConfigure }: { items: TickerItem[]; onConfigure?: () => void }) {
  // A sequência é duplicada para o loop ser contínuo: a faixa desliza -50% e reinicia
  // exatamente sobre a cópia, sem "salto".
  const loop = [...items, ...items];
  const duration = Math.max(40, Math.round(items.length * 6.5));

  return (
    <div className="ticker">
      <div className="ticker-viewport">
        {items.length ? (
          <div className="ticker-track" aria-hidden="true" style={{ animationDuration: `${duration}s` }}>
            {loop.map((item, index) => {
              const dir =
                item.change == null || item.change === 0 ? "flat" : item.change > 0 ? "up" : "down";
              const Arrow = dir === "down" ? ArrowDown : ArrowUp;
              return (
                <span className="ticker-item" key={`${item.symbol}-${index}`}>
                  <TickerIcon src={item.icon} label={item.symbol} />
                  <span className="ticker-symbol">{item.symbol}</span>
                  <span className="ticker-price">{currencyRaw(item.price, item.currency)}</span>
                  <span className={`ticker-change ${dir}`}>
                    {item.change == null ? (
                      "—"
                    ) : (
                      <>
                        <Arrow size={12} />
                        {signedPercent(item.change)}
                      </>
                    )}
                  </span>
                </span>
              );
            })}
          </div>
        ) : (
          <span className="ticker-empty">Nenhum ativo selecionado para a faixa</span>
        )}
      </div>
      {onConfigure && (
        <button
          className="ticker-config"
          onClick={onConfigure}
          aria-label="Escolher ativos da faixa"
          title="Escolher ativos"
        >
          <SlidersHorizontal size={15} />
        </button>
      )}
    </div>
  );
}

function TickerIcon({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="ticker-icon ticker-icon-fallback">{label.slice(0, 2)}</span>;
  }
  return <img className="ticker-icon" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function TickerSettings({
  candidates,
  hidden,
  onToggle,
  onShowAll,
  onClose
}: {
  candidates: TickerCandidate[];
  hidden: Set<string>;
  onToggle: (symbol: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const groups = [
    { id: "crypto", label: "Cripto", items: candidates.filter((item) => item.portfolio === "crypto") },
    { id: "b3", label: "Bolsa B3", items: candidates.filter((item) => item.portfolio === "b3") }
  ].filter((group) => group.items.length);
  const visible = candidates.filter((item) => !hidden.has(item.symbol)).length;

  return (
    <Modal title="Ativos na faixa" onClose={onClose} width={440}>
      <p className="ticker-settings-sub">
        {visible} de {candidates.length} ativos aparecendo na faixa
      </p>
      <div className="ticker-settings">
        {groups.map((group) => (
          <div className="ticker-settings-group" key={group.id}>
            <span className="ticker-settings-grouphead">{group.label}</span>
            {group.items.map((item) => (
              <label className="ticker-settings-row" key={item.symbol}>
                <span className="asset-name">
                  <AssetIcon src={item.icon} label={item.symbol} />
                  <strong>{item.symbol}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={!hidden.has(item.symbol)}
                  onChange={() => onToggle(item.symbol)}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onShowAll} disabled={hidden.size === 0}>
          Mostrar todos
        </Button>
        <Button onClick={onClose}>Concluído</Button>
      </div>
    </Modal>
  );
}
