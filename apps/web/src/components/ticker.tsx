import { ArrowDown, ArrowUp } from "lucide-react";
import { currencyRaw, signedPercent } from "../lib/format.js";

export type TickerItem = {
  symbol: string;
  price: number;
  currency: string;
  change: number | null;
};

export function Ticker({ items }: { items: TickerItem[] }) {
  if (!items.length) return null;
  // A sequência é duplicada para o loop ser contínuo: a faixa desliza -50% e reinicia
  // exatamente sobre a cópia, sem "salto".
  const loop = [...items, ...items];
  const duration = Math.max(24, Math.round(items.length * 3.4));

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
        {loop.map((item, index) => {
          const dir = item.change == null || item.change === 0 ? "flat" : item.change > 0 ? "up" : "down";
          const Arrow = dir === "down" ? ArrowDown : ArrowUp;
          return (
            <span className="ticker-item" key={`${item.symbol}-${index}`}>
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
