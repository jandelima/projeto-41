import { useId } from "react";
import { useTheme } from "../lib/theme.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Seletor de cor: roda RGB nativa, atalhos da paleta do tema e hex digitavel.
 *
 * `<input type="color">` da a roda pedida sem biblioteca nova, e ja vem
 * acessivel pelo teclado. O campo hex existe porque copiar a cor da marca de um
 * banco e mais rapido do que cacar o tom na roda.
 */
export function ColorPicker({
  value,
  onChange,
  label = "Cor"
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const { colors } = useTheme();
  const id = useId();
  const swatches = colors.series.slice(0, 8);

  return (
    <div className="fin-color-picker">
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="fin-color-row">
        <input
          type="color"
          className="fin-color-wheel"
          value={HEX.test(value) ? value : "#8b949e"}
          onChange={(event) => onChange(event.target.value)}
          aria-labelledby={`${id}-label`}
        />
        <input
          className="fin-color-hex"
          value={value}
          spellCheck={false}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.startsWith("#")
              ? event.target.value
              : `#${event.target.value}`;
            onChange(next.slice(0, 7));
          }}
          aria-label={`${label} em hexadecimal`}
        />
      </div>
      <div className="fin-swatches" role="group" aria-label="Cores do tema">
        {swatches.map((color) => (
          <button
            key={color}
            type="button"
            className={`fin-swatch ${color.toLowerCase() === value.toLowerCase() ? "active" : ""}`}
            style={{ background: color }}
            onClick={() => onChange(color)}
            aria-label={`Usar ${color}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Bolinha colorida usada nas listas de categoria, conta e pessoa. */
export function ColorDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="fin-dot"
      style={{ background: color, width: size, height: size }}
      aria-hidden
    />
  );
}
