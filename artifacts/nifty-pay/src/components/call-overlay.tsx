/**
 * CallOverlay — rendered inside AppLayout so it is always present regardless
 * of which page the user is on.
 *
 * • IncomingCallBanner: fixed banner at top of screen — accepts or declines
 * • ActiveCallOverlay:  full-screen WhatsApp-style call UI (Agora RTC)
 *   — remote video fills the screen, own camera floats top-right.
 */
import { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { useAgoraCall } from '@/contexts/agora-call';
import { useToast } from '@/hooks/use-toast';
import { RealtimeTranslatorPanel } from '@/components/realtime-translator';
import { LiveServicesDrawer } from '@/components/live-services-drawer';

/* ─── active call UI ─── */
function CallUI() {
  const {
    activeCall, callKind, remoteJoined, remoteVideoTrack, localVideoTrack,
    micOn, camOn, toggleMic, toggleCamera, requestVideoUpgrade, endCall, billing,
  } = useAgoraCall();
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const [seconds, setSeconds] = useState(0);
  const [translatorOpen, setTranslatorOpen] = useState(false);

  /* play remote video into the full-screen container */
  useEffect(() => {
    if (!remoteVideoTrack || !remoteRef.current) return undefined;
    remoteVideoTrack.play(remoteRef.current, { fit: 'cover' });
    return () => { try { remoteVideoTrack.stop(); } catch {} };
  }, [remoteVideoTrack]);

  /* play own camera into the floating box */
  useEffect(() => {
    if (!localVideoTrack || !localRef.current || !camOn) return undefined;
    localVideoTrack.play(localRef.current, { fit: 'cover' });
    return () => { try { localVideoTrack.stop(); } catch {} };
  }, [localVideoTrack, camOn]);

  /* call duration once connected */
  useEffect(() => {
    if (!remoteJoined) return;
    setSeconds(0);
    const iv = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [remoteJoined]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const otherName = activeCall?.otherName ?? 'Call';

  return (
    <div className="absolute inset-0">
      {/* ── Remote — fills the entire screen ── */}
      <div ref={remoteRef} className="absolute inset-0 bg-black" />
      {(!remoteVideoTrack) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/90">
          <div className="w-24 h-24 rounded-full bg-white/10 flex items-center justify-center">
            <span className="text-3xl font-bold">{otherName.slice(0, 2).toUpperCase()}</span>
          </div>
          <p className="font-semibold text-lg">{otherName}</p>
          {remoteJoined ? (
            <p className="text-sm text-white/70">{callKind === 'audio' ? `Voice call · ${mmss}` : mmss}</p>
          ) : (
            <p className="text-sm animate-pulse text-white/70">Ringing…</p>
          )}
        </div>
      )}

      {/* ── header with name + timer over remote video ── */}
      {remoteVideoTrack && (
        <div className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur text-white text-sm">
          {otherName} · {mmss}
        </div>
      )}

      {/* ── paid-call cost ticker (caller side only) ── */}
      {billing && (
        <div
          data-testid="paid-call-ticker"
          className={`absolute ${remoteVideoTrack ? 'top-14' : 'top-4'} left-4 z-10 px-3 py-1.5 rounded-full backdrop-blur text-sm font-semibold ${
            billing.remainingMinutes != null && billing.remainingMinutes <= 1
              ? 'bg-red-500/80 text-white animate-pulse'
              : 'bg-amber-500/25 text-amber-200 border border-amber-400/30'
          }`}
        >
          💰 {billing.accruedCost.toFixed(2)} {billing.currency}
          <span className="opacity-75 font-normal"> · {billing.ratePerMinute} {billing.currency}/min</span>
          {billing.remainingMinutes != null && billing.remainingMinutes <= 1 && (
            <span> · ends soon</span>
          )}
        </div>
      )}

      {/* ── Own camera — floating box, top-right ── */}
      {callKind === 'video' && (
        <div className="absolute top-4 right-4 w-[30vw] max-w-[140px] aspect-[3/4] rounded-2xl overflow-hidden border border-white/20 shadow-2xl z-10 bg-black/60">
          <div ref={localRef} className="w-full h-full" />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60">
              <VideoOff className="w-6 h-6" />
            </div>
          )}
        </div>
      )}

      {/* ── Controls — bottom center ── */}
      <div className="absolute inset-x-0 bottom-[4.75rem] z-10 flex justify-center px-4">
        <div className="rounded-full border border-cyan-300/15 bg-slate-950/55 px-3 py-1 text-[11px] text-white/60 backdrop-blur">
          <span className="font-semibold text-cyan-200">Langpretation</span>
          <span className="mx-1.5 text-white/30">·</span>
          <span>{translatorOpen ? 'Translator open · transcript will appear here' : 'Ready when you need it'}</span>
        </div>
      </div>
      <LiveServicesDrawer />
      <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center gap-5">
        <button
          onClick={() => setTranslatorOpen(true)}
          className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors"
          aria-label="Open live translator"
          title="Live Translator"
        >
          <img
            src="/langpretation.png"
            alt="Langpretation"
            className="h-8 w-8 rounded-full object-cover"
          />
        </button>

        {callKind === 'audio' && (
          <button
            onClick={() => void requestVideoUpgrade()}
            className="w-14 h-14 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors"
            aria-label="Request video"
            title="Request video"
          >
            <Video className="w-6 h-6" />
          </button>
        )}

        <button
          onClick={() => void toggleMic()}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-white text-black'}`}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {micOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </button>
        {callKind === 'video' && (
          <button
            onClick={() => void toggleCamera()}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${camOn ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-white text-black'}`}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {camOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </button>
        )}
        <button
          onClick={endCall}
          className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors"
          aria-label="End call"
        >
          <PhoneOff className="w-6 h-6 text-white" />
        </button>
      </div>

      <RealtimeTranslatorPanel
        open={translatorOpen}
        onClose={() => setTranslatorOpen(false)}
      />
    </div>
  );
}

/* ─── exported overlay — always rendered inside AppLayout ─── */
export function CallOverlay() {
  const {
    incomingCall,
    activeCall,
    videoUpgradeRequest,
    acceptCall,
    declineCall,
    acceptVideoUpgrade,
    declineVideoUpgrade,
  } = useAgoraCall();
  const { toast } = useToast();

  const callerName = incomingCall?.fromName ?? 'Someone';

  const handleAccept = async () => {
    try {
      await acceptCall();
    } catch (e: any) {
      console.error('[call] accept failed:', e);
      toast({ title: 'Could not join call', description: e?.message ?? String(e), variant: 'destructive' });
    }
  };

  return (
    <>
      {/* ── Incoming call — full-screen imo-style ring screen ── */}
      {incomingCall && !activeCall && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center text-white animate-in fade-in duration-300"
          style={{ background: 'linear-gradient(180deg, #0c2f2b 0%, #09131f 55%, #060a12 100%)' }}>

          {/* caller info */}
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">
            <div className="relative">
              {/* pulsing rings */}
              <span className="absolute inset-0 rounded-full bg-emerald-400/25 animate-ping" style={{ animationDuration: '1.6s' }} />
              <span className="absolute -inset-3 rounded-full border-2 border-emerald-400/25 animate-pulse" />
              <Avatar className="relative w-28 h-28 border-4 border-white/15 shadow-2xl">
                <AvatarFallback className="bg-primary/25 text-primary text-4xl font-bold">
                  {callerName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="text-center">
              <p className="text-3xl font-extrabold tracking-tight drop-shadow">{callerName}</p>
              <p className="mt-2 text-base font-semibold text-emerald-300/90 animate-pulse flex items-center justify-center gap-2">
                {incomingCall.kind === 'audio'
                  ? <><PhoneCall className="w-4 h-4" /> Incoming voice call…</>
                  : <><Video className="w-4 h-4" /> Incoming video call…</>}
              </p>
            </div>
          </div>

          {/* big bold accept / decline buttons */}
          <div className="w-full max-w-sm px-10 pb-14 flex items-end justify-between">
            <div className="flex flex-col items-center gap-2.5">
              <button
                onClick={declineCall}
                className="w-[76px] h-[76px] rounded-full bg-red-500 hover:bg-red-600 active:scale-95 flex items-center justify-center shadow-[0_10px_30px_rgba(239,68,68,0.45)] transition-all"
                aria-label="Decline call"
              >
                <PhoneOff className="w-9 h-9 text-white" strokeWidth={2.5} />
              </button>
              <span className="text-sm font-bold text-red-300">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <button
                onClick={handleAccept}
                className="w-[76px] h-[76px] rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 flex items-center justify-center shadow-[0_10px_30px_rgba(16,185,129,0.5)] transition-all animate-bounce"
                style={{ animationDuration: '1.4s' }}
                aria-label="Accept call"
              >
                {incomingCall.kind === 'audio'
                  ? <PhoneCall className="w-9 h-9 text-white" strokeWidth={2.5} />
                  : <Video className="w-9 h-9 text-white" strokeWidth={2.5} />}
              </button>
              <span className="text-sm font-bold text-emerald-300">Accept</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Active call full-screen overlay — persists across navigation ── */}
      {activeCall && (
        <div className="fixed inset-0 z-[190] bg-black flex flex-col">
          <CallUI />
        </div>
      )}

      {videoUpgradeRequest && activeCall && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-950 p-6 text-white shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/20">
              <Video className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-center text-xl font-bold">Video request</h2>
            <p className="mt-2 text-center text-sm text-white/65">
              {videoUpgradeRequest.fromName} would like to turn on video.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={declineVideoUpgrade}
                className="flex-1 rounded-xl bg-white/10 px-4 py-3 font-semibold text-white/80 hover:bg-white/15"
              >
                Stay on audio
              </button>
              <button
                onClick={() => void acceptVideoUpgrade()}
                className="flex-1 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Turn on video
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
