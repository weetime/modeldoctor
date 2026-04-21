import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en-US/common.json";
import enConnections from "@/locales/en-US/connections.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhConnections from "@/locales/zh-CN/connections.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
	resources: {
		"en-US": { common: enCommon, sidebar: enSidebar, connections: enConnections },
		"zh-CN": { common: zhCommon, sidebar: zhSidebar, connections: zhConnections },
	},
	lng: "en-US",
	fallbackLng: "en-US",
	defaultNS: "common",
	ns: ["common", "sidebar", "connections"],
	interpolation: { escapeValue: false },
	returnNull: false,
});

export default i18n;
