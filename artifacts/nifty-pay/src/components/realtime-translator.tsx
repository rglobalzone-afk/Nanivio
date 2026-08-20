import { useEffect, useRef, useState } from "react";
import { Languages, Loader2, Mic, X } from "lucide-react";
import { API_BASE as API } from "@/lib/api";

const LANGUAGE_OPTIONS = [
  ["auto", "Detect automatically"],
  ["en", "English"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["ar", "Arabic"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
];

function websocketUrl(token: string) {
  const url = new URL(API);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/translator/ws`;
  url.search = `?token=${encodeURIComponent(token)}`;
  return url.toString();
}

export function RealtimeTranslatorPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const socketRef = useRef<WebSocket | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Tap Continue to activate Langpretation.");

  useEffect(() => {
    if (open) return;
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("idle");
    setMessage("Tap Continue to activate Langpretation.");
  }, [open]);

  useEffect(() => () => socketRef.current?.close(), []);

  if (!open) return null;

  const start = async () => {
    setStatus("connecting");
    setMessage("Connecting to the live voice interpreter…");
    try {
      const tokenResponse = await fetch(`${API}/translator/session`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("nanivio_token")}` },
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.token) {
        throw new Error(tokenData.error ?? "Could not start Langpretation.");
      }

      const socket = new WebSocket(websocketUrl(tokenData.token));
      socketRef.current = socket;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "start", sourceLanguage, targetLanguage }));
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "translator_ready") {
          setStatus("ready");
          setMessage("Langpretation is ready for live voice translation.");
        } else if (data.type === "error") {
          setStatus("error");
          setMessage(data.message ?? "The interpreter is unavailable.");
        }
      };
      socket.onerror = () => {
        setStatus("error");
        setMessage("Could not connect to the live interpreter.");
      };
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not start Langpretation.");
    }
  };

  const languageLabel = (code: string) =>
    LANGUAGE_OPTIONS.find(([value]) => value === code)?.[1] ?? code;

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/65 px-4 pb-24 backdrop-blur-sm">
      <section className="w-full max-w-md overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,#141827,#080a11)] p-5 text-white shadow-2xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/langpretation.png"
              alt="Langpretation"
              className="h-14 w-14 rounded-2xl object-cover shadow-lg"
            />
            <div>
              <h2 className="text-lg font-extrabold">Langpretation</h2>
              <p className="text-xs text-white/55">Live voice-to-voice translation</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close Langpretation" className="rounded-full p-2 text-white/55 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-white/55">
            You speak
            <select
              value={sourceLanguage}
              onChange={(event) => setSourceLanguage(event.target.value)}
              disabled={status === "connecting" || status === "ready"}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm text-white outline-none"
            >
              {LANGUAGE_OPTIONS.map(([value, label]) => <option key={value} value={value} className="bg-slate-900">{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-white/55">
            Translate to
            <select
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
              disabled={status === "connecting" || status === "ready"}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm text-white outline-none"
            >
              {LANGUAGE_OPTIONS.filter(([value]) => value !== "auto").map(([value, label]) => <option key={value} value={value} className="bg-slate-900">{label}</option>)}
            </select>
          </label>
        </div>

        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${status === "error" ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-cyan-300/15 bg-cyan-400/5 text-white/75"}`}>
          <div className="flex items-center gap-2">
            {status === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "ready" ? <Mic className="h-4 w-4 text-cyan-300" /> : <Languages className="h-4 w-4 text-cyan-300" />}
            <span>{message}</span>
          </div>
        </div>

        {status === "idle" || status === "error" ? (
          <button onClick={() => void start()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-3 font-bold text-slate-950 hover:brightness-110">
            <Languages className="h-5 w-5" />
            Continue with {languageLabel(targetLanguage)}
          </button>
        ) : (
          <button onClick={onClose} className="mt-5 w-full rounded-xl bg-white/10 px-4 py-3 font-semibold text-white hover:bg-white/15">
            Return to call
          </button>
        )}
      </section>
    </div>
  );
}