import { useLocaleStore } from "@/stores/locale-store";
import { format, formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

interface RelativeTimeProps {
  date: string | number | Date;
  className?: string;
}

export function RelativeTime({ date, className }: RelativeTimeProps) {
  const locale = useLocaleStore((s) => s.locale);
  const dateFnsLocale = locale === "zh-CN" ? zhCN : enUS;
  const d = date instanceof Date ? date : new Date(date);
  const absolute = format(d, "yyyy-MM-dd HH:mm:ss");
  return (
    <time
      dateTime={d.toISOString()}
      title={absolute}
      className={className ?? "text-muted-foreground"}
    >
      {formatDistanceToNow(d, { addSuffix: true, locale: dateFnsLocale })}
    </time>
  );
}
