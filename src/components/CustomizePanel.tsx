import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, Database, Palette, RotateCcw, X } from "lucide-react";
import { ACCENTS, DEFAULT_SETTINGS, DENSITIES, normalizeHex, VOLUME_MODES } from "../lib/theme";
import DataPanel from "./DataPanel";
import ReminderSettingsPanel from "../features/reminders/ReminderSettingsPanel";
import { useApp } from "../store";

export default function CustomizePanel() {
  const open = useApp((state) => state.customizeOpen);
  const setOpen = useApp((state) => state.setCustomizeOpen);
  const tab = useApp((state) => state.settingsTab);
  const settings = useApp((state) => state.settings);
  const update = useApp((state) => state.updateSettings);
  const [hexDraft, setHexDraft] = useState(settings.accentHex);

  useEffect(() => {
    setHexDraft(settings.accentHex);
  }, [settings.accentHex, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const commitHex = (value: string) => {
    setHexDraft(value);
    const hex = normalizeHex(value);
    if (hex) update({ accent: "custom", accentHex: hex });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="customize-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
          />
          <motion.aside
            className="glass customize-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="customize-head">
              <div>
                <h2>Настройки</h2>
                <p>Оформление, напоминания и данные</p>
                <div className="panel-tabs">
                  <button
                    className={tab === "appearance" ? "active" : ""}
                    onClick={() => setOpen(true, "appearance")}
                  >
                    <Palette size={14} strokeWidth={1.5} /> Внешний вид
                  </button>
                  <button
                    className={tab === "reminders" ? "active" : ""}
                    onClick={() => setOpen(true, "reminders")}
                  >
                    <BellRing size={14} strokeWidth={1.5} /> Уведомления
                  </button>
                  <button
                    className={tab === "data" ? "active" : ""}
                    onClick={() => setOpen(true, "data")}
                  >
                    <Database size={14} strokeWidth={1.5} /> Данные
                  </button>
                </div>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть">
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            {tab === "data" ? (
              <DataPanel />
            ) : tab === "reminders" ? (
              <div className="customize-body">
                <ReminderSettingsPanel />
              </div>
            ) : (
            <div className="customize-body">
              <section>
                <h3>Акцентный цвет</h3>
                <div className="accent-grid">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.id}
                      className={`accent-option${settings.accent === accent.id ? " active" : ""}`}
                      onClick={() => update({ accent: accent.id, accentHex: accent.hex })}
                    >
                      <span style={{ background: accent.hex }} />
                      <span>{accent.label}</span>
                      {settings.accent === accent.id && <Check size={13} strokeWidth={2} />}
                    </button>
                  ))}
                </div>
                <div className="hex-row">
                  <label className="hex-preview" style={{ background: settings.accentHex }}>
                    <input
                      type="color"
                      value={normalizeHex(settings.accentHex) ?? DEFAULT_SETTINGS.accentHex}
                      onChange={(event) => commitHex(event.target.value)}
                      aria-label="Свой HEX-цвет"
                    />
                  </label>
                  <input
                    className="input"
                    value={hexDraft}
                    onChange={(event) => commitHex(event.target.value)}
                    placeholder="#8ce8f7"
                    aria-label="HEX-код"
                  />
                  <span className="quiet-meta">свой HEX</span>
                </div>
              </section>

              <section>
                <h3>Объём недели</h3>
                <div className="shape-grid">
                  {VOLUME_MODES.map((shape) => (
                    <button
                      key={shape.id}
                      className={`shape-option${settings.shape === shape.id ? " active" : ""}`}
                      onClick={() => update({ shape: shape.id })}
                    >
                      <strong>{shape.label}</strong>
                      <small>{shape.hint}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3>Liquid Glass</h3>
                <label className="slider-row">
                  <span>Размытие</span>
                  <input
                    type="range"
                    min={10}
                    max={40}
                    step={1}
                    value={settings.blur}
                    onChange={(event) => update({ blur: Number(event.target.value) })}
                  />
                  <strong>{settings.blur}px</strong>
                </label>
                <label className="slider-row">
                  <span>Прозрачность</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={settings.opacity}
                    onChange={(event) => update({ opacity: Number(event.target.value) })}
                  />
                  <strong>{settings.opacity}%</strong>
                </label>
                <label className="slider-row">
                  <span>Блики</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={settings.highlight}
                    onChange={(event) => update({ highlight: Number(event.target.value) })}
                  />
                  <strong>{settings.highlight}%</strong>
                </label>
              </section>

              <section>
                <h3>Плотность сетки</h3>
                <div className="segmented">
                  {DENSITIES.map((density) => (
                    <button
                      key={density.id}
                      className={settings.density === density.id ? "active" : ""}
                      onClick={() => update({ density: density.id })}
                    >
                      {density.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>
            )}

            <div className="customize-foot">
              {tab === "appearance" && (
                <button
                  className="ghost-btn"
                  onClick={() => {
                    update(DEFAULT_SETTINGS);
                    setHexDraft(DEFAULT_SETTINGS.accentHex);
                  }}
                >
                  <RotateCcw size={14} strokeWidth={1.5} /> Сбросить
                </button>
              )}
              <button className="primary-btn" onClick={() => setOpen(false)}>
                <Check size={16} strokeWidth={1.5} /> Готово
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
