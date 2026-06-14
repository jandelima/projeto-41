import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { ComponentType, InputHTMLAttributes, ReactNode } from "react";
import { signedPercent } from "../lib/format.js";

type IconType = ComponentType<{ size?: number | string; className?: string }>;

export function Card({
  children,
  className = "",
  glow = false
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <section className={`card ${glow ? "card-glow" : ""} ${className}`}>{children}</section>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  className = "",
  bodyClass = "",
  children
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  bodyClass?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={`panel-body ${bodyClass}`}>{children}</div>
    </Card>
  );
}

export function SectionHeading({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="section-actions">{children}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  icon: Icon,
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "soft" | "danger";
  icon?: IconType;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant} ${className}`} {...rest}>
      {Icon && <Icon size={17} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  tone = "",
  className = "",
  ...rest
}: {
  icon: IconType;
  label: string;
  tone?: "" | "danger";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`icon-btn ${tone} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={16} />
    </button>
  );
}

export function Stat({
  icon: Icon,
  label,
  value,
  detail,
  tone = ""
}: {
  icon: IconType;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "" | "positive" | "negative";
}) {
  return (
    <Card className={`stat ${tone}`}>
      <div className="stat-icon">
        <Icon size={19} />
      </div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {detail && <small className="stat-detail">{detail}</small>}
    </Card>
  );
}

export function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone = "",
  right
}: {
  icon: IconType;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "" | "positive" | "negative";
  right?: ReactNode;
}) {
  return (
    <Card className={`kpi ${tone}`}>
      <div className="kpi-icon">
        <Icon size={17} />
      </div>
      <div className="kpi-text">
        <span className="kpi-label">{label}</span>
        <strong className="kpi-value">{value}</strong>
        {detail && <small className="kpi-detail">{detail}</small>}
      </div>
      {right && <div className="kpi-right">{right}</div>}
    </Card>
  );
}

export function MiniStat({ label, value, tone = "" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <Card className="mini-stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </Card>
  );
}

export function Delta({ value, suffix }: { value: number; suffix?: string }) {
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${positive ? "delta-up" : "delta-down"}`}>
      <Icon size={14} />
      {signedPercent(value)}
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

export function Tag({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Avatar({ symbol }: { symbol: string }) {
  return <span className="avatar">{symbol.slice(0, 2)}</span>;
}

export function AssetIcon({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <Avatar symbol={label} />;
  return (
    <img
      className="avatar avatar-img"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={`status-dot status-${status}`} />;
}

export function Field({
  label,
  hint,
  children,
  full = false
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "field-full" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; tone?: string }[];
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`${value === option.value ? "active" : ""} ${option.tone ?? ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar"
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={15} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" step="any" inputMode="decimal" {...props} />;
}

export function Empty({ icon: Icon, text }: { icon: IconType; text: string }) {
  return (
    <div className="empty">
      <Icon size={26} />
      <span>{text}</span>
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton">
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} style={{ width: `${60 + ((index * 13) % 35)}%` }} />
      ))}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading">
      <span />
      <span />
      <span />
    </div>
  );
}
