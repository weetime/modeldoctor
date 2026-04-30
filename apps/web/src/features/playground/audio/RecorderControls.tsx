import { Button } from "@/components/ui/button";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export interface RecorderControlsProps {
  onComplete: (blob: Blob, mimeType: string, durationMs: number) => void;
}

type RecorderState = "idle" | "requesting" | "recording";

const PREFERRED_MIME_TYPES = ["audio/webm", "audio/mp4", ""];

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mt of PREFERRED_MIME_TYPES) {
    if (mt === "" || MediaRecorder.isTypeSupported(mt)) return mt || undefined;
  }
  return undefined;
}

export function RecorderControls({ onComplete }: RecorderControlsProps) {
  const { t } = useTranslation("playground");
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);

  const hasRecorderApi = typeof MediaRecorder !== "undefined";
  const enabled = hasRecorderApi && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (state !== "recording") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(id);
  }, [state]);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  const start = async () => {
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t("audio.stt.recorder.permissionDenied"));
      setState("idle");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType = pickSupportedMimeType();
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      const durationMs = Date.now() - startedAtRef.current;
      onComplete(blob, rec.mimeType, durationMs);
      cleanupStream();
      setState("idle");
    };
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    rec.start();
    setState("recording");
  };

  const stop = () => recorderRef.current?.stop();

  if (!enabled) {
    return (
      <Button type="button" variant="outline" disabled title={t("audio.stt.recorder.requiresHttps")}>
        <Mic className="h-4 w-4" />
        {t("audio.stt.recorder.start")}
      </Button>
    );
  }

  if (state === "recording") {
    return (
      <Button type="button" variant="destructive" onClick={stop}>
        <Square className="h-4 w-4" />
        {t("audio.stt.recorder.stop")} ({Math.floor(elapsed / 1000)}s)
      </Button>
    );
  }

  return (
    <Button type="button" variant="outline" onClick={start} disabled={state === "requesting"}>
      <Mic className="h-4 w-4" />
      {t("audio.stt.recorder.start")}
    </Button>
  );
}
