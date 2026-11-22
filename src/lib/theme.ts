import type { AccentId, Density, Settings, ShapeId } from "./types";

export interface ColorToken {
  hex: string;
  rgb: string;
}

export const COLORS: Record<string, ColorToken> = {
  violet: { hex: "#9fa8c9", rgb: "159, 168, 201" },
  cyan: { hex: "#8ce8f7", rgb: "140, 232, 247" },
  emerald: { hex: "#8fc7b2", rgb: "143, 199, 178" },
  amber: { hex: "#d8c08a", rgb: "216, 192, 138" },
  rose: { hex: "#c99aa4", rgb: "201, 154, 164" },
  blue: { hex: "#8fb4d9", rgb: "143, 180, 217" },
  pink: { hex: "#c39ab6", rgb: "195, 154, 182" },
  lime: { hex: "#a9c58b", rgb: "169, 197, 139" },
  indigo: { hex: "#9aa3d0", rgb: "154, 163, 208" },
  chrome: { hex: "#dfe5e8", rgb: "223, 229, 232" },
};

export const COLOR_NAMES = Object.keys(COLORS);

export const token = (color: string): ColorToken => COLORS[color] ?? COLORS.cyan;

export interface AccentPreset {
  id: AccentId;
  label: string;
  hex: string;
  on: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: "ice", label: "Ледяной голубой", hex: "#8ce8f7", on: "#041418" },
  { id: "emerald", label: "Неоновый изумруд", hex: "#7df0b8", on: "#04180f" },
  { id: "chrome", label: "Чистый хром", hex: "#e6e9ec", on: "#0b0d0e" },
  { id: "amber", label: "Плазменный янтарь", hex: "#ffc46b", on: "#1a1002" },
  { id: "violet", label: "Кибер-фиолетовый", hex: "#b69bff", on: "#120a20" },
];

export const VOLUME_MODES: Array<{ id: ShapeId; label: string; hint: string }> = [
  { id: "week", label: "Неделя в объёме", hint: "семь плиток на направляющей" },
  { id: "off", label: "Плоский вид", hint: "без WebGL" },
];

export const DENSITIES: Array<{ id: Density; label: string }> = [
  { id: "compact", label: "Компактный список" },
  { id: "cards", label: "Карточки" },
];

export const DEFAULT_SETTINGS: Settings = {
  accent: "ice",
  accentHex: "#8ce8f7",
  shape: "week",
  blur: 28,
  opacity: 62,
  highlight: 45,
  density: "cards",
};

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return null;
}

export function hexToRgb(hex: string): string {
  const value = normalizeHex(hex) ?? DEFAULT_SETTINGS.accentHex;
  const int = parseInt(value.slice(1), 16);
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}

export function accentFor(settings: Settings): { hex: string; on: string } {
  if (settings.accent === "custom") {
    return { hex: normalizeHex(settings.accentHex) ?? DEFAULT_SETTINGS.accentHex, on: "#041014" };
  }
  const preset = ACCENTS.find((item) => item.id === settings.accent) ?? ACCENTS[0];
  return { hex: preset.hex, on: preset.on };
}

export function applySettings(settings: Settings): void {
  if (typeof document === "undefined") return;
  const { hex, on } = accentFor(settings);
  const root = document.documentElement;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-rgb", hexToRgb(hex));
  root.style.setProperty("--on-accent", on);
  root.style.setProperty("--glass-blur", `${settings.blur}px`);
  root.style.setProperty(
    "--glass-alpha",
    String(0.2 + (settings.opacity / 100) * 0.8),
  );
  root.style.setProperty("--glass-highlight", String(settings.highlight / 100));
  root.dataset.density = settings.density;
}
