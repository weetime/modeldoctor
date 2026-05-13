import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function ReproduceBanner({
  runId,
  sampleId,
  expected,
}: {
  runId: string;
  sampleId: string;
  expected: string;
}) {
  const { t } = useTranslation("quality-gate");

  return (
    <Alert>
      <AlertTitle>{t("playground.bannerTitle", { suffix: sampleId.slice(-6) })}</AlertTitle>
      <AlertDescription>
        {t("playground.bannerExpectedPrefix")}
        {expected.slice(0, 120)}
        {expected.length > 120 ? "…" : ""}
        {" · "}
        <Link className="underline" to={`/quality-gate/runs/${runId}`}>
          {t("playground.backToReport")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
