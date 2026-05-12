import { Button } from "@/components/ui/button";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

// 192KB so the ~33% base64 overhead stays under the contract's 256KB string cap.
const MAX_BYTES = 192 * 1024;

function initialsFor(email: string, displayName: string | null): string {
  const src = displayName?.trim() || email;
  return src.slice(0, 2).toUpperCase();
}

interface Props {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  onChange: (next: string | null) => void;
  pending?: boolean;
}

export function AvatarUpload({ email, displayName, avatarUrl, onChange, pending }: Props) {
  const { t } = useTranslation("me");
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error(t("profile.avatarHint"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onChange(result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-muted-foreground">
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
        ) : (
          <span>{initialsFor(email, displayName)}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {t("profile.avatarUpload")}
          </Button>
          {avatarUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onChange(null)}
            >
              {t("profile.avatarRemove")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("profile.avatarHint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
