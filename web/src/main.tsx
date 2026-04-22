import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import "./lib/i18n";
import { useLocaleStore } from "./stores/locale-store";

// Force the locale store to hydrate before render so i18n.language is correct.
useLocaleStore.getState();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
