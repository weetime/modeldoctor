import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en-US/common.json";
import enSidebar from "@/locales/en-US/sidebar.json";
import zhCommon from "@/locales/zh-CN/common.json";
import zhSidebar from "@/locales/zh-CN/sidebar.json";

void i18n.use(initReactI18next).init({
	resources: {
		"en-US": { common: enCommon, sidebar: enSidebar },
		"zh-CN": { common: zhCommon, sidebar: zhSidebar },
	},
	lng: "en-US",
	fallbackLng: "en-US",
	defaultNS: "common",
	ns: ["common", "sidebar"],
	interpolation: { escapeValue: false },
	returnNull: false,
});

export default i18n;
