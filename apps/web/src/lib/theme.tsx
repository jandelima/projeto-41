import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeName = "dark" | "light";

type ThemeContextValue = {
  theme: ThemeName;
  toggle: () => void;
  colors: ChartColors;
};

export type ChartColors = {
  accent: string;
  accentSoft: string;
  positive: string;
  negative: string;
  grid: string;
  axis: string;
  series: string[];
};

const palettes: Record<ThemeName, ChartColors> = {
  dark: {
    accent: "#4f8ff7",
    accentSoft: "#4f8ff7",
    positive: "#34d39a",
    negative: "#fb7185",
    grid: "rgba(255,255,255,0.07)",
    axis: "#828ca0",
    series: ["#4f8ff7", "#2dd4bf", "#f5a742", "#fb7185", "#38bdf8", "#94a3b8", "#0ea5e9"]
  },
  light: {
    accent: "#2f6fed",
    accentSoft: "#2f6fed",
    positive: "#0f9d6b",
    negative: "#e0356b",
    grid: "rgba(15,23,42,0.08)",
    axis: "#7a8699",
    series: ["#2f6fed", "#0d9488", "#d98324", "#e0356b", "#0284c7", "#64748b", "#0891b2"]
  }
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "projeto41-theme";

function readInitial(): ThemeName {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(readInitial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((current) => (current === "dark" ? "light" : "dark")), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggle, colors: palettes[theme] }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme deve ser usado dentro de ThemeProvider");
  return context;
}
