let ctx: AudioContext | null = null;
function getCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Short chime for incoming messages */
export function playMessageNotification() {
  try {
    const src = `${import.meta.env.BASE_URL}sounds/message-tone.wav`;
    const audio = new Audio(src);
    audio.volume = 1.0;
    const played = audio.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => playGeneratedMessageNotification());
    }
    return;
  } catch {
    playGeneratedMessageNotification();
  }
}

/** WebAudio fallback if the custom message tone cannot be played. */
function playGeneratedMessageNotification() {
  try {
    const ac = getCtx();
    const freqs = [880, 1100, 1320];
    freqs.forEach((f, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.value = f;
      const t = ac.currentTime + i * 0.1;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t); osc.stop(t + 0.18);
    });
  } catch { /* audio blocked */ }
}

/** Repeating ringtone. Returns a stop function. */
export function createRingtone(type: 'incoming' | 'outgoing'): () => void {
  // Preferred: real ringtone audio files (loud, phone-like). Falls back to
  // WebAudio-generated tones if playback is blocked or the file fails.
  const src = `${import.meta.env.BASE_URL}sounds/${type === 'incoming' ? 'ringtone-incoming' : 'ringback-outgoing'}.mp3`;
  try {
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 1.0;
    const played = audio.play();
    if (played && typeof played.catch === 'function') {
      let stopped = false;
      let fallbackStop: (() => void) | null = null;
      played.catch(() => { if (!stopped) fallbackStop = createOscRingtone(type); });
      return () => {
        stopped = true;
        audio.pause();
        audio.src = '';
        fallbackStop?.();
      };
    }
    return () => { audio.pause(); audio.src = ''; };
  } catch {
    return createOscRingtone(type);
  }
}

/** WebAudio fallback ringtone (used if audio file playback fails). */
function createOscRingtone(type: 'incoming' | 'outgoing'): () => void {
  let live = true;
  function ring() {
    if (!live) return;
    try {
      const ac = getCtx();
      if (type === 'incoming') {
        // Two short bursts like a phone ring
        [[440, 0, 0.35], [440, 0.45, 0.35]].forEach(([freq, delay, dur]) => {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.connect(g); g.connect(ac.destination);
          osc.frequency.value = freq as number;
          const t = ac.currentTime + (delay as number);
          g.gain.setValueAtTime(0.3, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + (dur as number));
          osc.start(t); osc.stop(t + (dur as number));
        });
        setTimeout(ring, 3200);
      } else {
        // Single steady tone for outgoing
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.connect(g); g.connect(ac.destination);
        osc.frequency.value = 480;
        const t = ac.currentTime;
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        osc.start(t); osc.stop(t + 1.0);
        setTimeout(ring, 2800);
      }
    } catch { /* audio blocked */ }
  }
  ring();
  return () => { live = false; };
}
