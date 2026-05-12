import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";
import { PasswordSection } from "./PasswordSection";
import { ProfileSection } from "./ProfileSection";

export function MePage(): JSX.Element {
  const { t } = useTranslation("me");
  return (
    <>
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <div className="px-8 py-6 space-y-8">
        <ProfileSection />
        <PasswordSection />
      </div>
    </>
  );
}
