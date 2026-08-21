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
  // Calls use a short "too-too" cadence rather than one long sustained tone.
  // Keeping this in WebAudio also makes the cadence consistent across browsers
  // and avoids the long imported ringtone files sounding like a continuous note.
  return createOscRingtone(type);
}

/** Repeating WebAudio "too-too" call cadence. */
function createOscRingtone(type: 'incoming' | 'outgoing'): () => void {
  let live = true;
  function ring() {
    if (!live) return;
    try {
      const ac = getCtx();
      if (ac.state === 'suspended') void ac.resume();
      // Two clearly separated short tones: too ... too.
      const cadence = type === 'incoming'
        ? [[660, 0], [660, 0.34]]
        : [[520, 0], [520, 0.34]];
      cadence.forEach(([freq, delay]) => {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.connect(g); g.connect(ac.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ac.currentTime + delay;
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.28, t + 0.025);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.start(t);
        osc.stop(t + 0.24);
      });
      setTimeout(ring, type === 'incoming' ? 3000 : 2500);
    } catch { /* audio blocked */ }
  }
  ring();
  return () => { live = false; };
}
