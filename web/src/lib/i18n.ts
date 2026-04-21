import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en-US/common.json";
import enConnections from "@/locales/en-US/connections.json";
import enE2E from "@/locales/en-US/e2e.json";
import enLoadTest from "@/locales/en-US/load-test.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhConnections from "@/locales/zh-CN/connections.json";
import zhE2E from "@/locales/zh-CN/e2e.json";
import zhLoadTest from "@/locales/zh-CN/load-test.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
	resources: {
		"en-US": {
			common: enCommon,
			sidebar: enSidebar,
			connections: enConnections,
			"load-test": enLoadTest,
			e2e: enE2E,
		},
		"zh-CN": {
			common: zhCommon,
			sidebar: zhSidebar,
			connections: zhConnections,
			"load-test": zhLoadTest,
			e2e: zhE2E,
		},
	},
	lng: "en-US",
	fallbackLng: "en-US",
	defaultNS: "common",
	ns: ["common", "sidebar", "connections", "load-test", "e2e"],
	interpolation: { escapeValue: false },
	returnNull: false,
});

export default i18n;
