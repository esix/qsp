// @ts-ignore
import MidiPlayerLib from 'midi-player-js';
// @ts-ignore
import Soundfont from 'soundfont-player';

// ─── GM instrument name table (program 0-127) ────────────────────

const GM_NAMES: string[] = [
  'acoustic_grand_piano','bright_acoustic_piano','electric_grand_piano','honkytonk_piano',
  'electric_piano_1','electric_piano_2','harpsichord','clavinet',
  'celesta','glockenspiel','music_box','vibraphone',
  'marimba','xylophone','tubular_bells','dulcimer',
  'drawbar_organ','percussive_organ','rock_organ','church_organ',
  'reed_organ','accordion','harmonica','tango_accordion',
  'acoustic_guitar_nylon','acoustic_guitar_steel','electric_guitar_jazz','electric_guitar_clean',
  'electric_guitar_muted','overdriven_guitar','distortion_guitar','guitar_harmonics',
  'acoustic_bass','electric_bass_finger','electric_bass_pick','fretless_bass',
  'slap_bass_1','slap_bass_2','synth_bass_1','synth_bass_2',
  'violin','viola','cello','contrabass',
  'tremolo_strings','pizzicato_strings','orchestral_harp','timpani',
  'string_ensemble_1','string_ensemble_2','synth_strings_1','synth_strings_2',
  'choir_aahs','voice_oohs','synth_choir','orchestra_hit',
  'trumpet','trombone','tuba','muted_trumpet',
  'french_horn','brass_section','synth_brass_1','synth_brass_2',
  'soprano_sax','alto_sax','tenor_sax','baritone_sax',
  'oboe','english_horn','bassoon','clarinet',
  'piccolo','flute','recorder','pan_flute',
  'blown_bottle','shakuhachi','whistle','ocarina',
  'lead_1_square','lead_2_sawtooth','lead_3_calliope','lead_4_chiff',
  'lead_5_charang','lead_6_voice','lead_7_fifths','lead_8_bass_lead',
  'pad_1_new_age','pad_2_warm','pad_3_polysynth','pad_4_choir',
  'pad_5_bowed','pad_6_metallic','pad_7_halo','pad_8_sweep',
  'fx_1_rain','fx_2_soundtrack','fx_3_crystal','fx_4_atmosphere',
  'fx_5_brightness','fx_6_goblins','fx_7_echoes','fx_8_sci_fi',
  'sitar','banjo','shamisen','koto',
  'kalimba','bagpipe','fiddle','shanai',
  'tinkle_bell','agogo','steel_drums','woodblock',
  'taiko_drum','melodic_tom','synth_drum','reverse_cymbal',
  'guitar_fret_noise','breath_noise','seashore','bird_tweet',
  'telephone_ring','helicopter','applause','gunshot',
];

function midiNoteToName(n: number): string {
  const names = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  return names[n % 12] + (Math.floor(n / 12) - 1);
}

// ─── MidiAudioPlayer ─────────────────────────────────────────────

export class MidiAudioPlayer {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  // Cache: GM program number → loaded instrument promise
  private instrumentCache = new Map<number, Promise<any>>();
  // Channel (1-16) → current GM program
  private channelPrograms = new Map<number, number>();
  // Active note nodes for Note Off
  private activeNotes = new Map<string, { stop: (when?: number) => void }>();

  private midiPlayer: any = null;
  private currentUrl: string | null = null;
  private _gameVolume = 1.0;  // set by PLAY / SETVOL
  private _userVolume = 1.0;  // set by the slider

  // ─── Public API ──────────────────────────────────────────────

  async play(url: string, volume: number): Promise<void> {
    if (!url) return;
    this._gameVolume = Math.max(0, Math.min(100, volume)) / 100;
    if (url.toUpperCase() === this.currentUrl) {
      this.applyGain();
      return;
    }
    this.stopAll();
    this.currentUrl = url.toUpperCase();

    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    this.gainNode!.gain.setValueAtTime(this._gameVolume * this._userVolume, ctx.currentTime);

    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buffer = await resp.arrayBuffer();

      const player = new MidiPlayerLib.Player();
      player.loadArrayBuffer(buffer);

      // Pre-load all instruments declared in the file
      const programs: number[] = player.instruments ?? [];
      if (!programs.includes(0)) programs.push(0); // always have piano
      await Promise.all(programs.map(p => this.loadInstrument(p)));

      // Bail if we were stopped while loading
      if (this.currentUrl !== url.toUpperCase()) return;

      this.midiPlayer = player;
      this.channelPrograms.clear();
      this.activeNotes.clear();

      player.on('midiEvent', (ev: any) => this.handleEvent(ev));
      player.on('endOfFile', () => {
        if (this.midiPlayer === player) {
          player.stop();
          player.resetTracks();
          player.play();
        }
      });

      player.play();
    } catch (e) {
      console.warn('MIDI play failed:', e);
    }
  }

  stop(url: string | null): void {
    if (url === null || url.toUpperCase() === this.currentUrl) {
      this.stopAll();
    }
  }

  /** Called by SETVOL — sets game volume and syncs with user slider */
  setGameVolume(volume: number): void {
    this._gameVolume = Math.max(0, Math.min(100, volume)) / 100;
    this.applyGain();
  }

  /** Called by the UI slider */
  setUserVolume(volume: number): void {
    this._userVolume = Math.max(0, Math.min(100, volume)) / 100;
    this.applyGain();
  }

  private applyGain(): void {
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(this._gameVolume * this._userVolume, this.audioCtx.currentTime);
    }
  }

  // ─── Private ─────────────────────────────────────────────────

  private ensureContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  private loadInstrument(program: number): Promise<any> {
    let p = this.instrumentCache.get(program);
    if (!p) {
      const ctx = this.ensureContext();
      const name = GM_NAMES[program] ?? 'acoustic_grand_piano';
      p = Soundfont.instrument(ctx, name, { destination: this.gainNode! });
      this.instrumentCache.set(program, p);
    }
    return p;
  }

  private handleEvent(ev: any): void {
    const ctx = this.audioCtx;
    if (!ctx) return;

    const channel: number = ev.channel ?? 1;

    if (ev.name === 'Program Change') {
      const prog = ev.value ?? 0;
      this.channelPrograms.set(channel, prog);
      // Kick off loading if not cached yet
      this.loadInstrument(prog).catch(() => {});
      return;
    }

    // Skip drums (channel 10 in 1-based MIDI)
    if (channel === 10) return;

    const program = this.channelPrograms.get(channel) ?? 0;
    const noteKey = `${channel}-${ev.noteNumber ?? 0}`;

    if (ev.name === 'Note on' && (ev.velocity ?? 0) > 0) {
      const noteName = midiNoteToName(ev.noteNumber as number);
      const gain = (ev.velocity as number) / 127;
      const inst = this.instrumentCache.get(program);
      if (!inst) return;
      inst.then((i: any) => {
        if (this.midiPlayer === null) return;
        const prev = this.activeNotes.get(noteKey);
        try { prev?.stop(0); } catch {}
        const node = i.play(noteName, ctx.currentTime, { gain });
        if (node) this.activeNotes.set(noteKey, node);
      });
    } else if (ev.name === 'Note off' || (ev.name === 'Note on' && (ev.velocity ?? 0) === 0)) {
      const prev = this.activeNotes.get(noteKey);
      if (prev) {
        try { prev.stop(ctx.currentTime + 0.05); } catch {}
        this.activeNotes.delete(noteKey);
      }
    }
  }

  private stopAll(): void {
    if (this.midiPlayer) {
      try { this.midiPlayer.stop(); } catch {}
      this.midiPlayer = null;
    }
    for (const node of this.activeNotes.values()) {
      try { node.stop(0); } catch {}
    }
    this.activeNotes.clear();
    this.currentUrl = null;
  }
}

// ─── HTML5 Audio fallback for non-MIDI formats ───────────────────

export class SimpleAudioPlayer {
  private playing = new Map<string, HTMLAudioElement>();
  private _gameVolume = 1.0;  // set by PLAY / SETVOL
  private _userVolume = 1.0;  // set by the slider
  /** Called when a file finishes playing naturally (not stopped manually) */
  onFileEnded?: (url: string) => void;

  /** Called by SETVOL — sets game volume and syncs with user slider */
  setGameVolume(volume: number): void {
    this._gameVolume = Math.max(0, Math.min(100, volume)) / 100;
    this.applyVolume();
  }

  /** Called by the UI slider */
  setUserVolume(volume: number): void {
    this._userVolume = Math.max(0, Math.min(100, volume)) / 100;
    this.applyVolume();
  }

  private applyVolume(): void {
    const v = this._gameVolume * this._userVolume;
    for (const a of this.playing.values()) a.volume = v;
  }

  play(url: string, volume: number): void {
    if (!url) return;
    this._gameVolume = Math.max(0, Math.min(100, volume)) / 100;
    const v = this._gameVolume * this._userVolume;
    const existing = this.playing.get(url.toUpperCase());
    if (existing) {
      existing.volume = v;
      return;
    }
    const audio = new Audio(url);
    audio.volume = v;
    audio.addEventListener('ended', () => {
      this.playing.delete(url.toUpperCase());
      this.onFileEnded?.(url);
    });
    audio.play().catch(() => {});
    this.playing.set(url.toUpperCase(), audio);
  }

  stop(url: string | null): void {
    if (url === null) {
      for (const a of this.playing.values()) { a.pause(); a.src = ''; }
      this.playing.clear();
    } else {
      const a = this.playing.get(url.toUpperCase());
      if (a) { a.pause(); a.src = ''; this.playing.delete(url.toUpperCase()); }
    }
  }
}
