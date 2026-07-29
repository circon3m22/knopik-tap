type UltraStopResult = "success" | "overheat" | "cancel";

type UltraVoice = {
  noise: AudioBufferSourceNode;
  flame: OscillatorNode;
  rumble: OscillatorNode;
  lfo: OscillatorNode;
  output: GainNode;
  nodes: AudioNode[];
};

type WebkitWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

/**
 * Small procedural sound engine for KNOPIK TAP.
 * AudioContext is created only after the first call, so importing is SSR-safe.
 */
export class KnopikSoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ultra: UltraVoice | null = null;
  private enabled = true;
  private volume = 0.72;
  private lastUltraPulse = 0;

  constructor(options?: { enabled?: boolean; volume?: number }) {
    this.enabled = options?.enabled ?? true;
    this.volume = clamp(options?.volume ?? 0.72, 0, 1);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.disposeUltra(0.04);
  }

  setVolume(volume: number) {
    this.volume = clamp(volume, 0, 1);
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.volume, now, 0.025);
  }

  /** Call from a pointer/touch event to satisfy mobile autoplay policies. */
  unlock() {
    const ctx = this.getContext();
    if (ctx?.state === "suspended") void ctx.resume();
  }

  tap(intensity = 0.5) {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const force = clamp(intensity, 0, 1);

    this.tonalHit(now, {
      type: "triangle",
      from: 178 + force * 55,
      to: 92 + force * 18,
      duration: 0.085,
      gain: 0.045 + force * 0.025,
    });
    this.tonalHit(now + 0.006, {
      type: "sine",
      from: 520 + force * 140,
      to: 250 + force * 55,
      duration: 0.045,
      gain: 0.018 + force * 0.012,
    });
    this.noiseHit(now, 0.055, 950 + force * 850, 2.4, 0.028 + force * 0.014);
  }

  warning(level = 0.65) {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;
    const danger = clamp(level, 0, 1);

    this.tonalHit(now, {
      type: "sawtooth",
      from: 112 + danger * 24,
      to: 72,
      duration: 0.28,
      gain: 0.035 + danger * 0.025,
      attack: 0.025,
      lowpass: 620,
    });
    this.tonalHit(now + 0.08, {
      type: "triangle",
      from: 170,
      to: 112,
      duration: 0.22,
      gain: 0.03,
      attack: 0.018,
      lowpass: 480,
    });
    this.noiseHit(now + 0.01, 0.24, 430, 1.1, 0.024 + danger * 0.02);
  }

  bite() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    this.noiseHit(now, 0.42, 720, 0.85, 0.15);
    this.noiseHit(now + 0.025, 0.14, 2_700, 3.2, 0.055);
    this.tonalHit(now, {
      type: "sawtooth",
      from: 138,
      to: 42,
      duration: 0.48,
      gain: 0.11,
      lowpass: 680,
    });
    this.tonalHit(now + 0.035, {
      type: "square",
      from: 74,
      to: 31,
      duration: 0.24,
      gain: 0.035,
      lowpass: 310,
    });
  }

  levelUp() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    this.filteredSweep(now, 0.56, 520, 4_200, 0.038);
    [392, 523.25, 659.25, 783.99, 1_046.5].forEach(
      (frequency, index) => {
        this.tonalHit(now + index * 0.055, {
          type: index % 2 === 0 ? "sine" : "triangle",
          from: frequency,
          to: frequency * 1.018,
          duration: 0.46,
          gain: 0.035 - index * 0.003,
          attack: 0.012,
        });
      },
    );
  }

  safe() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    this.tonalHit(now, {
      type: "square",
      from: 118,
      to: 82,
      duration: 0.16,
      gain: 0.065,
      lowpass: 790,
    });
    this.noiseHit(now, 0.11, 1_350, 2.1, 0.065);
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      this.tonalHit(now + 0.1 + index * 0.065, {
        type: "sine",
        from: frequency,
        to: frequency * 1.012,
        duration: 0.3,
        gain: 0.035 - index * 0.004,
        attack: 0.008,
      });
    });
  }

  rest() {
    const ctx = this.ready();
    if (!ctx) return;
    const now = ctx.currentTime;

    this.filteredSweep(now, 0.72, 1_900, 480, 0.052);
    this.tonalHit(now + 0.05, {
      type: "sine",
      from: 246.94,
      to: 196,
      duration: 0.55,
      gain: 0.034,
      attack: 0.06,
    });
    this.tonalHit(now + 0.12, {
      type: "sine",
      from: 185,
      to: 147,
      duration: 0.58,
      gain: 0.025,
      attack: 0.08,
    });
  }

  /** Starts a continuous, layered fire sound. Safe to call repeatedly. */
  ultraStart() {
    const ctx = this.ready();
    if (!ctx || this.ultra) return;
    const now = ctx.currentTime;
    const master = this.master!;

    this.filteredSweep(now, 0.48, 280, 3_600, 0.09);
    this.tonalHit(now, {
      type: "sawtooth",
      from: 72,
      to: 154,
      duration: 0.34,
      gain: 0.055,
      attack: 0.025,
      lowpass: 720,
    });

    const output = ctx.createGain();
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.075, now + 0.26);
    output.connect(master);

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoise(ctx);
    noise.loop = true;
    const fireBand = ctx.createBiquadFilter();
    fireBand.type = "bandpass";
    fireBand.frequency.setValueAtTime(1_250, now);
    fireBand.Q.value = 0.7;
    const fireGain = ctx.createGain();
    fireGain.gain.value = 0.62;
    noise.connect(fireBand).connect(fireGain).connect(output);

    const flame = ctx.createOscillator();
    flame.type = "sawtooth";
    flame.frequency.value = 94;
    const flameFilter = ctx.createBiquadFilter();
    flameFilter.type = "lowpass";
    flameFilter.frequency.value = 430;
    const flameGain = ctx.createGain();
    flameGain.gain.value = 0.18;
    flame.connect(flameFilter).connect(flameGain).connect(output);

    const rumble = ctx.createOscillator();
    rumble.type = "sine";
    rumble.frequency.value = 47;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.28;
    rumble.connect(rumbleGain).connect(output);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 7.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.22;
    lfo.connect(lfoGain).connect(fireGain.gain);

    noise.start(now);
    flame.start(now);
    rumble.start(now);
    lfo.start(now);
    this.lastUltraPulse = 0;
    this.ultra = {
      noise,
      flame,
      rumble,
      lfo,
      output,
      nodes: [fireBand, fireGain, flameFilter, flameGain, rumbleGain, lfoGain],
    };
  }

  /** Adds a short ember crackle while ultra mode is charging. */
  ultraPulse(intensity = 0.5) {
    const ctx = this.ready();
    if (!ctx || !this.ultra) return;
    const now = ctx.currentTime;
    if (now - this.lastUltraPulse < 0.055) return;
    this.lastUltraPulse = now;
    const heat = clamp(intensity, 0, 1);

    this.noiseHit(now, 0.035 + heat * 0.035, 1_900 + Math.random() * 2_600, 4.5, 0.018 + heat * 0.025);
    if (Math.random() < 0.46 + heat * 0.34) {
      this.tonalHit(now, {
        type: "triangle",
        from: 360 + Math.random() * 420,
        to: 145 + Math.random() * 90,
        duration: 0.045 + Math.random() * 0.045,
        gain: 0.014 + heat * 0.014,
      });
    }
    this.ultra.flame.frequency.setTargetAtTime(94 + heat * 58, now, 0.06);
    this.ultra.rumble.frequency.setTargetAtTime(47 + heat * 13, now, 0.08);
  }

  stopUltraLoop(result: UltraStopResult = "success") {
    const ctx = this.context;
    if (!ctx || !this.ultra) return;
    const now = ctx.currentTime;
    this.disposeUltra(result === "overheat" ? 0.075 : 0.16);

    if (result === "success") {
      [392, 523.25, 659.25, 783.99].forEach((frequency, index) => {
        this.tonalHit(now + index * 0.055, {
          type: index % 2 ? "triangle" : "sine",
          from: frequency,
          to: frequency * 1.025,
          duration: 0.42,
          gain: 0.04 - index * 0.004,
          attack: 0.012,
        });
      });
      this.filteredSweep(now, 0.28, 780, 3_400, 0.045);
    } else if (result === "overheat") {
      this.noiseHit(now, 0.62, 560, 0.72, 0.17);
      this.noiseHit(now + 0.018, 0.24, 2_300, 2.1, 0.08);
      this.tonalHit(now, {
        type: "sawtooth",
        from: 174,
        to: 36,
        duration: 0.68,
        gain: 0.12,
        lowpass: 690,
      });
    }
  }

  /** Alias convenient for pointer-up handlers. */
  ultraStop(result: UltraStopResult = "success") {
    this.stopUltraLoop(result);
  }

  close() {
    this.disposeUltra(0.02);
    const ctx = this.context;
    this.context = null;
    this.master = null;
    this.noise = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  private ready() {
    if (!this.enabled) return null;
    const ctx = this.getContext();
    if (ctx?.state === "suspended") void ctx.resume();
    return ctx;
  }

  private getContext() {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;
    const AudioContextCtor =
      window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor({ latencyHint: "interactive" });
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.context = ctx;
    this.master = master;
    return ctx;
  }

  private getNoise(ctx: AudioContext) {
    if (this.noise) return this.noise;
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.72 + white * 0.28;
      channel[index] = white * 0.58 + previous * 0.42;
    }
    this.noise = buffer;
    return buffer;
  }

  private tonalHit(
    when: number,
    options: {
      type: OscillatorType;
      from: number;
      to: number;
      duration: number;
      gain: number;
      attack?: number;
      lowpass?: number;
    },
  ) {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const attack = options.attack ?? 0.004;
    const end = when + options.duration;

    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(Math.max(1, options.from), when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), end);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(options.gain, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    if (options.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      oscillator.connect(filter).connect(gain);
      oscillator.addEventListener("ended", () => filter.disconnect(), { once: true });
    } else {
      oscillator.connect(gain);
    }
    gain.connect(master);
    oscillator.start(when);
    oscillator.stop(end + 0.01);
    oscillator.addEventListener(
      "ended",
      () => {
        oscillator.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
  }

  private noiseHit(when: number, duration: number, frequency: number, q: number, gainValue: number) {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const end = when + duration;

    source.buffer = this.getNoise(ctx);
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + Math.min(0.012, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(master);
    source.start(when, Math.random() * 0.8);
    source.stop(end + 0.01);
    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
  }

  private filteredSweep(when: number, duration: number, from: number, to: number, gainValue: number) {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const end = when + duration;

    source.buffer = this.getNoise(ctx);
    filter.type = "bandpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(from, when);
    filter.frequency.exponentialRampToValueAtTime(to, end);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(gainValue, when + duration * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(master);
    source.start(when, Math.random() * 0.5);
    source.stop(end + 0.02);
    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
  }

  private disposeUltra(fadeSeconds: number) {
    const voice = this.ultra;
    const ctx = this.context;
    if (!voice || !ctx) return;
    this.ultra = null;
    const now = ctx.currentTime;
    const stopAt = now + fadeSeconds + 0.025;
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(0.0001, now, Math.max(0.008, fadeSeconds / 3));
    [voice.noise, voice.flame, voice.rumble, voice.lfo].forEach((source) => {
      try {
        source.stop(stopAt);
      } catch {
        // A stopped source is already safe to discard.
      }
    });
    voice.noise.addEventListener(
      "ended",
      () => {
        voice.nodes.forEach((node) => node.disconnect());
        voice.output.disconnect();
      },
      { once: true },
    );
  }
}

export function createSoundEngine(options?: { enabled?: boolean; volume?: number }) {
  return new KnopikSoundEngine(options);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export type { UltraStopResult };
