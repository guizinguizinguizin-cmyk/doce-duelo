// Motor de audio procedural.
//
// Todo som e sintetizado em tempo real com WebAudio — nao ha um unico arquivo
// .mp3 no projeto. Isso mantem o PWA pequeno, funcionando offline de verdade,
// e sem nenhuma questao de licenca de trilha.
//
// Dois detalhes que fazem a diferenca na sensacao do jogo:
//  - o som de combinacao SOBE de tom a cada cascata, entao uma reacao em
//    cadeia longa vira uma escada musical em vez de sete blips iguais;
//  - a musica e agendada com lookahead (o padrao "A Tale of Two Clocks"), nao
//    com setInterval disparando notas. setInterval derrapa e a batida treme.

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

// Pentatonica maior: qualquer sequencia dessas notas soa bem, o que importa
// quando a ordem depende do tamanho da cascata do jogador.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

const noteToFreq = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);

// Progressao I-V-vi-IV em Do: alegre, e o loop nao cansa rapido.
const PROGRESSION = [
  { bass: -21, chord: [3, 7, 10] }, // C
  { bass: -14, chord: [-2, 2, 7] }, // G
  { bass: -12, chord: [0, 3, 7] }, // Am
  { bass: -17, chord: [-1, 3, 8] }, // F
];

export function createAudio() {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let musicFilter = null;
  let compressor = null;

  let unlocked = false;
  let musicPlaying = false;
  let schedulerTimer = null;
  let nextNoteTime = 0;
  let step = 0;
  let intensity = 0;

  const settings = {
    muted: false,
    music: 0.35,
    sfx: 0.7,
  };

  function ensureContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    // Compressor no final da cadeia: sem ele, uma cascata grande dispara dez
    // sons juntos e o resultado satura e estala no alto-falante do celular.
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    masterGain = ctx.createGain();
    masterGain.gain.value = settings.muted ? 0 : 1;

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 1800;
    musicFilter.Q.value = 0.6;

    musicGain = ctx.createGain();
    musicGain.gain.value = settings.music;

    sfxGain = ctx.createGain();
    sfxGain.gain.value = settings.sfx;

    musicGain.connect(musicFilter);
    musicFilter.connect(compressor);
    sfxGain.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    return ctx;
  }

  /**
   * Navegador nao deixa tocar som antes de um gesto do usuario. Chamar isso no
   * primeiro toque/clique, sempre.
   */
  function unlock() {
    const c = ensureContext();
    if (!c) return false;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
    return true;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function canPlay() {
    return unlocked && ctx && !settings.muted;
  }

  // -------------------------------------------------------------------------
  // Blocos de sintese
  // -------------------------------------------------------------------------

  function tone({
    freq,
    type = 'sine',
    start = 0,
    duration = 0.2,
    attack = 0.005,
    gain = 0.3,
    slideTo = null,
    detune = 0,
    destination = null,
  }) {
    const t0 = now() + start;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);

    // Decaimento exponencial ate um valor minimo positivo: ramp exponencial
    // para zero e invalido e o Chrome ignora silenciosamente a curva inteira.
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(env);
    env.connect(destination || sfxGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
    return osc;
  }

  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function noise({
    start = 0,
    duration = 0.25,
    gain = 0.3,
    filterType = 'lowpass',
    filterFrom = 4000,
    filterTo = 400,
    Q = 1,
  }) {
    const t0 = now() + start;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = Q;
    filter.frequency.setValueAtTime(filterFrom, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(sfxGain);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // -------------------------------------------------------------------------
  // Efeitos do jogo
  // -------------------------------------------------------------------------

  const sfx = {
    tap() {
      tone({ freq: 660, type: 'triangle', duration: 0.06, gain: 0.12 });
    },

    swap() {
      tone({ freq: 420, type: 'triangle', duration: 0.09, gain: 0.16, slideTo: 620 });
    },

    swapFail() {
      tone({ freq: 200, type: 'sawtooth', duration: 0.12, gain: 0.14, slideTo: 120 });
    },

    /** Tom sobe conforme a cascata: cadeia longa vira escada musical. */
    match(cascade = 1, size = 3) {
      const step = PENTATONIC[Math.min(cascade - 1, PENTATONIC.length - 1)];
      const base = noteToFreq(step - 9);
      tone({ freq: base, type: 'sine', duration: 0.26, gain: 0.26, attack: 0.004 });
      tone({ freq: base * 2, type: 'triangle', duration: 0.16, gain: 0.1, attack: 0.004 });
      if (size >= 5) {
        tone({ freq: base * 3, type: 'sine', start: 0.03, duration: 0.2, gain: 0.08 });
      }
      noise({ duration: 0.1, gain: 0.05, filterFrom: 6000, filterTo: 1500, filterType: 'bandpass' });
    },

    createSpecial() {
      tone({ freq: 700, type: 'triangle', duration: 0.3, gain: 0.2, slideTo: 1400 });
      tone({ freq: 1050, type: 'sine', start: 0.06, duration: 0.25, gain: 0.12, slideTo: 2100 });
    },

    striped() {
      noise({ duration: 0.32, gain: 0.3, filterType: 'bandpass', filterFrom: 700, filterTo: 5200, Q: 3 });
      tone({ freq: 300, type: 'sawtooth', duration: 0.22, gain: 0.12, slideTo: 1600 });
    },

    wrapped() {
      noise({ duration: 0.42, gain: 0.38, filterFrom: 3200, filterTo: 180 });
      tone({ freq: 150, type: 'sine', duration: 0.4, gain: 0.34, slideTo: 46 });
      tone({ freq: 300, type: 'square', duration: 0.14, gain: 0.1, slideTo: 90 });
    },

    colorBomb() {
      noise({ duration: 0.75, gain: 0.4, filterFrom: 7000, filterTo: 140 });
      tone({ freq: 900, type: 'sine', duration: 0.6, gain: 0.26, slideTo: 70 });
      tone({ freq: 450, type: 'triangle', start: 0.05, duration: 0.5, gain: 0.18, slideTo: 60 });
      for (let i = 0; i < 4; i++) {
        tone({
          freq: noteToFreq(PENTATONIC[i + 3] - 9),
          type: 'sine',
          start: 0.04 * i,
          duration: 0.35,
          gain: 0.1,
        });
      }
    },

    /** Enviar ataque: som sobe, sensacao de algo saindo. */
    attackSend() {
      tone({ freq: 240, type: 'square', duration: 0.26, gain: 0.14, slideTo: 900 });
      noise({ duration: 0.2, gain: 0.1, filterType: 'bandpass', filterFrom: 900, filterTo: 3600, Q: 2 });
    },

    /** Levar ataque: som desce e sujo, sensacao de impacto. */
    attackTake() {
      tone({ freq: 380, type: 'sawtooth', duration: 0.34, gain: 0.26, slideTo: 60 });
      noise({ duration: 0.3, gain: 0.24, filterFrom: 1800, filterTo: 120 });
    },

    danger() {
      tone({ freq: 180, type: 'square', duration: 0.5, gain: 0.14, slideTo: 150 });
    },

    countdown(final = false) {
      tone({
        freq: final ? 880 : 520,
        type: 'triangle',
        duration: final ? 0.45 : 0.16,
        gain: 0.24,
      });
    },

    victory() {
      const notes = [0, 4, 7, 12, 16, 19];
      notes.forEach((n, i) => {
        tone({ freq: noteToFreq(n - 9), type: 'triangle', start: i * 0.1, duration: 0.5, gain: 0.22 });
        tone({ freq: noteToFreq(n + 12 - 9), type: 'sine', start: i * 0.1, duration: 0.4, gain: 0.1 });
      });
    },

    defeat() {
      const notes = [7, 4, 0, -5];
      notes.forEach((n, i) => {
        tone({ freq: noteToFreq(n - 9), type: 'triangle', start: i * 0.16, duration: 0.6, gain: 0.2 });
      });
      noise({ start: 0.5, duration: 0.7, gain: 0.14, filterFrom: 1200, filterTo: 90 });
    },

    eliminate() {
      tone({ freq: 520, type: 'square', duration: 0.4, gain: 0.16, slideTo: 90 });
      noise({ duration: 0.35, gain: 0.16, filterFrom: 2400, filterTo: 150 });
    },
  };

  function play(name, ...args) {
    if (!canPlay()) return;
    const fn = sfx[name];
    if (!fn) return;
    try {
      fn(...args);
    } catch (err) {
      // Um efeito que falha nunca pode derrubar o jogo.
      if (typeof console !== 'undefined') console.debug('audio sfx falhou:', name, err);
    }
  }

  // -------------------------------------------------------------------------
  // Musica
  // -------------------------------------------------------------------------

  function scheduleStep(stepIndex, time) {
    const bar = Math.floor(stepIndex / 8) % PROGRESSION.length;
    const beat = stepIndex % 8;
    const { bass, chord } = PROGRESSION[bar];
    const driving = intensity > 0.55;

    if (beat === 0 || beat === 4 || (driving && beat === 6)) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(noteToFreq(bass), time);
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(0.5, time + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
      osc.connect(env);
      env.connect(musicGain);
      osc.start(time);
      osc.stop(time + 0.36);
    }

    // Arpejo: sobe e desce dentro do acorde da barra.
    const arpPattern = [0, 1, 2, 1, 0, 2, 1, 2];
    const note = chord[arpPattern[beat] % chord.length];
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(noteToFreq(note + 12), time);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(driving ? 0.13 : 0.08, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    osc.connect(env);
    env.connect(musicGain);
    osc.start(time);
    osc.stop(time + 0.18);

    // Chapeu de ruido so na parte tensa: e o que faz a musica "acelerar"
    // sem mudar o andamento (mudar o BPM no meio soa quebrado).
    if (driving && beat % 2 === 1) {
      const src = ctx.createBufferSource();
      src.buffer = getNoiseBuffer();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      const env2 = ctx.createGain();
      env2.gain.setValueAtTime(0.06, time);
      env2.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      src.connect(hp);
      hp.connect(env2);
      env2.connect(musicGain);
      src.start(time);
      src.stop(time + 0.06);
    }
  }

  function scheduler() {
    if (!ctx) return;
    const secondsPerStep = 60 / 124 / 2; // colcheias a 124 bpm
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += secondsPerStep;
      step++;
    }
  }

  function startMusic() {
    if (!unlocked || settings.muted || musicPlaying) return;
    ensureContext();
    musicPlaying = true;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.08;
    schedulerTimer = setInterval(scheduler, LOOKAHEAD_MS);
  }

  function stopMusic() {
    musicPlaying = false;
    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = null;
  }

  /**
   * 0 = calmo, 1 = barra quase cheia. Abre o filtro e liga a percussao, dando
   * sensacao de perigo sem trocar de faixa.
   */
  function setIntensity(value) {
    intensity = Math.max(0, Math.min(1, value));
    if (musicFilter && ctx) {
      const target = 1500 + intensity * 5000;
      musicFilter.frequency.setTargetAtTime(target, ctx.currentTime, 0.3);
    }
  }

  // -------------------------------------------------------------------------
  // Ajustes
  // -------------------------------------------------------------------------

  function setMuted(value) {
    settings.muted = !!value;
    if (masterGain && ctx) {
      masterGain.gain.setTargetAtTime(settings.muted ? 0 : 1, ctx.currentTime, 0.05);
    }
    if (settings.muted) stopMusic();
  }

  function setMusicVolume(v) {
    settings.music = Math.max(0, Math.min(1, v));
    if (musicGain && ctx) musicGain.gain.setTargetAtTime(settings.music, ctx.currentTime, 0.05);
  }

  function setSfxVolume(v) {
    settings.sfx = Math.max(0, Math.min(1, v));
    if (sfxGain && ctx) sfxGain.gain.setTargetAtTime(settings.sfx, ctx.currentTime, 0.05);
  }

  return {
    unlock,
    play,
    startMusic,
    stopMusic,
    setIntensity,
    setMuted,
    setMusicVolume,
    setSfxVolume,
    get isMuted() {
      return settings.muted;
    },
    get musicVolume() {
      return settings.music;
    },
    get sfxVolume() {
      return settings.sfx;
    },
    get isPlayingMusic() {
      return musicPlaying;
    },
  };
}
