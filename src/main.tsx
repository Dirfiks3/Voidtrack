import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installGlobalErrorHandlers, reportCrash } from "./lib/errorLog";
import "./index.css";

installGlobalErrorHandlers();

// Мобильный CSS-режим включается до первого рендера: тяжёлые эффекты
// (backdrop-filter, большие тени) не должны попадать даже в первый кадр.
document.documentElement.dataset.platform = /android/i.test(navigator.userAgent)
  ? "mobile"
  : "desktop";

const container = document.getElementById("root");
if (!container) {
  reportCrash(new Error("Не найден корневой элемент #root"), "bootstrap");
} else {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
