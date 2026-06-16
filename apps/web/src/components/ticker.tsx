import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { currencyRaw, signedPercent } from "../lib/format.js";

export type TickerItem = {
  symbol: string;
  price: number;
  currency: string;
  change: number | null;
  icon?: string;
};

export function Ticker({ items }: { items: TickerItem[] }) {
  if (!items.length) return null;
  // A sequência é duplicada para o loop ser contínuo: a faixa desliza -50% e reinicia
  // exatamente sobre a cópia, sem "salto".
  const loop = [...items, ...items];
  const duration = Math.max(40, Math.round(items.length * 6.5));

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
        {loop.map((item, index) => {
          const dir = item.change == null || item.change === 0 ? "flat" : item.change > 0 ? "up" : "down";
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
    </div>
  );
}

function TickerIcon({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="ticker-icon ticker-icon-fallback">{label.slice(0, 2)}</span>;
  }
  return (
    <img
      className="ticker-icon"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
