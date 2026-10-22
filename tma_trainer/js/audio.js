/* Synthesised sound (no audio files) and spoken callouts. */
'use strict';
(function () {
  var ctx = null;
  var master = null;
  var hum = null;
  var listen = null;
  var state = { sound: true, voice: true };

  function noiseBuffer(seconds, brown) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        d[i] = w;
      }
    }
    return buf;
  }

  function init() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
      return;
    }
    master = ctx.createGain();
    master.gain.value = state.sound ? 0.8 : 0;
    master.connect(ctx.destination);

    // Hull ambience: brown noise through a low-pass that opens with speed.
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4, true);
    src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    var g = ctx.createGain();
    g.gain.value = 0.22;
    src.connect(lp).connect(g).connect(master);
    src.start();
    // faint machinery tone
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 58;
    var og = ctx.createGain();
    og.gain.value = 0.018;
    osc.connect(og).connect(master);
    osc.start();
    hum = { lp: lp, g: g };

    // Listening channel: band-passed noise beating at the blade rate.
    var ls = ctx.createBufferSource();
    ls.buffer = noiseBuffer(3, false);
    ls.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    var am = ctx.createGain();
    am.gain.value = 0;
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 4;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain).connect(am.gain);
    var lg = ctx.createGain();
    lg.gain.value = 0;
    ls.connect(bp).connect(am).connect(lg).connect(master);
    ls.start();
    lfo.start();
    listen = { am: am, lfo: lfo, lfoGain: lfoGain, out: lg, bp: bp };
  }

  function env(node, t0, a, peak, decay) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + decay);
  }

  function blip(freq, dur, vol, type) {
    if (!ctx || !state.sound) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    var g = ctx.createGain();
    env(g, t, 0.005, vol, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noiseHit(dur, filterType, f0, f1, vol, attack) {
    var t = ctx.currentTime;
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(dur + 0.2, false);
    var f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain();
    env(g, t, attack || 0.01, vol, dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.2);
  }

  var sounds = {
    click: function () {
      blip(1800, 0.03, 0.05, 'square');
    },
    contact: function () {
      blip(880, 0.12, 0.12);
      setTimeout(function () {
        blip(1320, 0.18, 0.1);
      }, 140);
    },
    acquire: function () {
      for (var i = 0; i < 3; i++) {
        (function (k) {
          setTimeout(function () {
            blip(1500, 0.08, 0.12, 'triangle');
          }, k * 120);
        })(i);
      }
    },
    launch: function () {
      if (!ctx || !state.sound) return;
      blip(55, 0.5, 0.9);
      noiseHit(2.2, 'bandpass', 2400, 300, 0.5, 0.05);
      var t = ctx.currentTime + 0.4;
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(1100, t + 2.5);
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      o.connect(lp).connect(g).connect(master);
      o.start(t);
      o.stop(t + 4.2);
    },
    boom: function () {
      if (!ctx || !state.sound) return;
      noiseHit(4.5, 'lowpass', 900, 60, 1.0, 0.02);
      blip(38, 3.5, 0.9);
    },
  };

  function play(name) {
    if (!ctx || !state.sound || !sounds[name]) return;
    if (ctx.state === 'suspended') ctx.resume();
    sounds[name]();
  }

  function setSpeed(kts) {
    if (!hum) return;
    var t = ctx.currentTime;
    hum.lp.frequency.setTargetAtTime(150 + kts * 22, t, 0.5);
    hum.g.gain.setTargetAtTime(0.16 + kts * 0.012, t, 0.5);
  }

  // Blade-rate beat of the selected contact; strength is signal excess in dB.
  function setListen(on, bladeHz, strength) {
    if (!listen) return;
    var t = ctx.currentTime;
    var v = on ? Math.max(0, Math.min(1, (strength + 4) / 16)) * 0.35 : 0;
    listen.out.gain.setTargetAtTime(v, t, 0.3);
    listen.lfoGain.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.3);
    listen.am.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.3);
    if (bladeHz) listen.lfo.frequency.setTargetAtTime(Math.max(0.5, Math.min(30, bladeHz)), t, 0.3);
  }

  function setSound(on) {
    state.sound = on;
    if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
  }

  var voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var vs = window.speechSynthesis.getVoices() || [];
    var pref = vs.filter(function (v) {
      return /en[-_](US|GB)/i.test(v.lang);
    });
    var male = pref.filter(function (v) {
      return /male|david|daniel|alex|fred|george|guy/i.test(v.name) && !/female/i.test(v.name);
    });
    return male[0] || pref[0] || vs[0] || null;
  }

  function say(text) {
    if (!state.voice || !text || !('speechSynthesis' in window)) return;
    try {
      var ss = window.speechSynthesis;
      if (ss.pending || (ss.speaking && text.length > 60)) ss.cancel();
      if (!voice) voice = pickVoice();
      var u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = 1.08;
      u.pitch = 0.85;
      u.volume = 0.9;
      ss.speak(u);
    } catch (e) {
      /* speech is optional */
    }
  }

  function setVoice(on) {
    state.voice = on;
    if (!on && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  TMA.Audio = {
    init: init,
    play: play,
    say: say,
    setSpeed: setSpeed,
    setListen: setListen,
    setSound: setSound,
    setVoice: setVoice,
    state: state,
  };
})();
