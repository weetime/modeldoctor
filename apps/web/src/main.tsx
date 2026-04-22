import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import i18n from "./lib/i18n";
import { useLocaleStore } from "./stores/locale-store";

// Sync i18n to the (hydrated or detected) store locale before first render.
// Without this, first-time zh-browser visitors briefly see the en fallback
// because i18n's own default runs before persist rehydration.
void i18n.changeLanguage(useLocaleStore.getState().locale);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
