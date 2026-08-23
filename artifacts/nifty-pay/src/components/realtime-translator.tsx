import { useCallback, useEffect, useRef, useState } from "react";
import { Languages, Loader2, Mic, Square, X } from "lucide-react";
import { API_BASE as API } from "@/lib/api";
import { useAgoraCall } from "@/contexts/agora-call";
import { PcmCapture } from "@/lib/translator/pcm-capture";
import {
  RealtimeTranslator,
  type TranslatorEvent,
} from "@/lib/translator/realtime-translator";

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

/**
 * In-call Langpretation bridge.
 *
 * The original Agora microphone is captured as PCM and sent to the
 * authenticated realtime gateway. Returned translated PCM is played into a
 * MediaStreamDestination, which is published as the user's call audio while
 * the original microphone is muted. The ordinary call remains intact and is
 * restored when Langpretation is stopped.
 */
export function RealtimeTranslatorPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    activeCall,
    getMicrophoneTrack,
    publishTranslatedAudio,
    unpublishTranslatedAudio,
    setOriginalMicMuted,
  } = useAgoraCall();
  const translatorRef = useRef<RealtimeTranslator | null>(null);
  const captureRef = useRef<PcmCapture | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const nextAudioTimeRef = useRef(0);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [status, setStatus] = useState<"idle" | "connecting" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Tap Continue to activate Langpretation.");
  const [enabled, setEnabled] = useState(false);

  const stop = useCallback(async () => {
    translatorRef.current?.sendControl({ type: "stop" });
    translatorRef.current?.disconnect();
    translatorRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    await unpublishTranslatedAudio();
    await setOriginalMicMuted(false);
    if (playbackContextRef.current) {
      await playbackContextRef.current.close().catch(() => {});
    }
    playbackContextRef.current = null;
    destinationRef.current = null;
    nextAudioTimeRef.current = 0;
    setEnabled(false);
    setStatus("idle");
    setMessage("Tap Continue to activate Langpretation.");
  }, [setOriginalMicMuted, unpublishTranslatedAudio]);

  const playPcm = useCallback((audio: ArrayBuffer) => {
    const context = playbackContextRef.current;
    if (!context) return;
    const samples = new Int16Array(audio);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) {
      channel[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7fff);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    // Route translated speech back into the Agora-published destination
    // track, not the local speakers (the remote listener should hear it once).
    const destination = destinationRef.current;
    if (!destination) return;
    source.connect(destination);
    const startAt = Math.max(context.currentTime + 0.02, nextAudioTimeRef.current);
    source.start(startAt);
    nextAudioTimeRef.current = startAt + buffer.duration;
  }, []);

  const start = useCallback(async () => {
    if (!activeCall) {
      setStatus("error");
      setMessage("Langpretation is available inside an active call.");
      return;
    }
    setStatus("connecting");
    setMessage("Connecting to the live voice interpreter…");
    try {
      const tokenResponse = await fetch(`${API}/translator/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("nanivio_token")}` },
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.token) {
        throw new Error(tokenData.error ?? "Could not start Langpretation.");
      }

      const context = new AudioContext({ latencyHint: "interactive" });
      if (context.state === "suspended") await context.resume();
      const destination = context.createMediaStreamDestination();
      playbackContextRef.current = context;
      destinationRef.current = destination;

      const translator = new RealtimeTranslator({
        sourceLanguage,
        targetLanguage,
        enabled: true,
      });
      translatorRef.current = translator;
      translator.on((event: TranslatorEvent) => {
        if (event.type === "audio" && event.audio) playPcm(event.audio);
        if (event.type === "status" && event.message === "speaking") setStatus("ready");
        if (event.type === "error") {
          setStatus("error");
          setMessage(event.message ?? "The interpreter is unavailable.");
        }
      });
      await translator.connect(websocketUrl(tokenData.token));

      const translatedTrack = destination.stream.getAudioTracks()[0];
      if (!translatedTrack) throw new Error("Could not create translated call audio.");
      await publishTranslatedAudio(translatedTrack);
      await setOriginalMicMuted(true);

      const capture = new PcmCapture();
      captureRef.current = capture;
      await capture.start(
        (audio) => translator.sendAudio(audio),
        getMicrophoneTrack() ?? undefined,
      );
      setEnabled(true);
      setStatus("ready");
      setMessage(`Active · hearing ${LANGUAGE_OPTIONS.find(([value]) => value === targetLanguage)?.[1] ?? targetLanguage}`);
    } catch (error) {
      await stop();
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not start Langpretation.");
    }
  }, [
    activeCall,
    getMicrophoneTrack,
    playPcm,
    publishTranslatedAudio,
    setOriginalMicMuted,
    sourceLanguage,
    stop,
    targetLanguage,
  ]);

  useEffect(() => {
    if (open) return;
    void stop();
  }, [open, stop]);

  useEffect(() => () => { void stop(); }, [stop]);

  if (!open) return null;

  const languageLabel = (code: string) =>
    LANGUAGE_OPTIONS.find(([value]) => value === code)?.[1] ?? code;

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/65 px-4 pb-24 backdrop-blur-sm">
      <section className="w-full max-w-md overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,#141827,#080a11)] p-5 text-white shadow-2xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/langpretation.png" alt="Langpretation" className="h-14 w-14 rounded-2xl object-cover shadow-lg" />
            <div>
              <h2 className="text-lg font-extrabold">Langpretation</h2>
              <p className="text-xs text-white/55">Your voice. Their language.</p>
            </div>
          </div>
          <button onClick={() => { void stop(); onClose(); }} aria-label="Close Langpretation" className="rounded-full p-2 text-white/55 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-white/55">
            You speak
            <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)} disabled={status === "connecting" || enabled} className="mt-2 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm text-white outline-none">
              {LANGUAGE_OPTIONS.map(([value, label]) => <option key={value} value={value} className="bg-slate-900">{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-white/55">
            Translate to
            <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} disabled={status === "connecting" || enabled} className="mt-2 w-full rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm text-white outline-none">
              {LANGUAGE_OPTIONS.filter(([value]) => value !== "auto").map(([value, label]) => <option key={value} value={value} className="bg-slate-900">{label}</option>)}
            </select>
          </label>
        </div>

        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${status === "error" ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-cyan-300/15 bg-cyan-400/5 text-white/75"}`}>
          <div className="flex items-center gap-2">
            {status === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? <Mic className="h-4 w-4 text-cyan-300" /> : <Languages className="h-4 w-4 text-cyan-300" />}
            <span>{message}</span>
          </div>
        </div>

        {enabled ? (
          <button onClick={() => void stop()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-3 font-semibold text-white hover:bg-white/15">
            <Square className="h-4 w-4" /> Stop Langpretation
          </button>
        ) : (
          <button onClick={() => void start()} disabled={status === "connecting"} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-3 font-bold text-slate-950 hover:brightness-110 disabled:opacity-60">
            <Languages className="h-5 w-5" /> Continue with {languageLabel(targetLanguage)}
          </button>
        )}
      </section>
    </div>
  );
}