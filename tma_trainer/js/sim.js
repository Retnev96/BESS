/* The simulated world: own ship, contacts, passive sensor, auto-tracker,
 * operator tracks with their ruler solutions, and torpedoes. Pure logic: no
 * drawing here, so the whole thing can be stepped headless. */
'use strict';
(function () {
  var U = TMA.U;
  var KT = U.KT;

  var DT = 0.5; // physics step, game seconds
  var SENSOR_DT = 2; // one bearing per detected contact every 2 s
  var HIST_DT = 2;
  var ROW_DT = 3; // waterfall row period
  var WF_BINS = 720; // 0.5 degree bins
  var LOST_AFTER = 50;
  var BAFFLE_HALF = 30; // blind arc either side of dead astern
  var PREROLL = 150;

  var TORP = {
    spdKts: 45,
    maxRun: 30000,
    turn: 5,
    turnHoming: 10,
    seekerHalf: 40,
  };

  var TYPES = {
    merchant: {
      name: 'MERCHANT', desc: 'Bulk carrier', sl: 157, spd: [10, 15], tpk: [5.5, 7],
      shafts: 1, blades: [4, 5], turn: 0.5, accel: 0.04, maxSpd: 16, hitR: 80, evade: false,
    },
    tanker: {
      name: 'TANKER', desc: 'Product tanker', sl: 159, spd: [11, 14], tpk: [5, 6],
      shafts: 1, blades: [4, 5], turn: 0.4, accel: 0.03, maxSpd: 15, hitR: 90, evade: false,
    },
    trawler: {
      name: 'TRAWLER', desc: 'Stern trawler', sl: 153, spd: [5, 9], tpk: [18, 24],
      shafts: 1, blades: [3, 4], turn: 1.2, accel: 0.08, maxSpd: 12, hitR: 35, evade: false, fishing: true,
    },
    warship: {
      name: 'WARSHIP', desc: 'Frigate', sl: 153, spd: [12, 18], tpk: [8, 10],
      shafts: 2, blades: [5, 5], turn: 1.5, accel: 0.15, maxSpd: 28, hitR: 60, evade: true,
    },
    submarine: {
      name: 'SUBMARINE', desc: 'Diesel-electric submarine', sl: 147, spd: [5, 9], tpk: [9, 11],
      shafts: 1, blades: [7, 7], turn: 1.2, accel: 0.1, maxSpd: 20, hitR: 40, evade: true,
    },
  };

  var DIFFS = {
    easy: {
      label: 'EASY', noise: 0.6, swapP: 0, reinitPerMin: 0, maneuverP: 0, fishing: false,
      evade: false, demon: 'full', types: ['merchant', 'tanker', 'merchant', 'tanker'],
    },
    normal: {
      label: 'NORMAL', noise: 1.0, swapP: 0.35, reinitPerMin: 0, maneuverP: 0.15, fishing: true,
      evade: true, demon: 'class', types: ['merchant', 'warship', 'trawler', 'tanker'],
    },
    hard: {
      label: 'HARD', noise: 1.35, swapP: 0.6, reinitPerMin: 0.04, maneuverP: 0.45, fishing: true,
      evade: true, demon: 'raw', types: ['warship', 'merchant', 'submarine', 'trawler', 'tanker'],
    },
  };

  var TRACK_COLORS = ['#f2d45c', '#ff7aa2', '#9be564', '#b79cff', '#ff9f43', '#3ee0c5', '#e7e7a0', '#f59fe0'];

  // ---- acoustics -------------------------------------------------------
  function noiseLevel(spdKts) {
    var self = 48 + 32 * Math.log10(Math.max(spdKts, 4) / 4);
    return 10 * Math.log10(Math.pow(10, 7) + Math.pow(10, self / 10));
  }
  function srcLevel(type, spdKts) {
    return type.sl + 15 * Math.log10(Math.max(spdKts, 3) / 10);
  }
  function transLoss(yd) {
    var m = Math.max(yd * 0.9144, 50);
    return 20 * Math.log10(m) + (0.08 * m) / 1000;
  }
  // Range (yd) at which signal excess hits zero with own ship at spdKts.
  function detRange(type, tgtKts, ownKts) {
    var tl = srcLevel(type, tgtKts) - noiseLevel(ownKts) + 2;
    var lo = 100,
      hi = 200000;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (transLoss(mid) > tl) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  // ---- ruler solutions -------------------------------------------------
  // A solution is the ruler: point A at time ta and point B at time tb.
  // The implied target moves in a straight line at constant speed.
  function solVel(sol) {
    if (!sol) return null;
    var dt = sol.tb - sol.ta;
    if (Math.abs(dt) < 1) return null;
    return { vx: (sol.bx - sol.ax) / dt, vy: (sol.by - sol.ay) / dt };
  }
  function solPos(sol, t) {
    var v = solVel(sol);
    if (!v) return { x: sol.bx, y: sol.by };
    return { x: sol.ax + v.vx * (t - sol.ta), y: sol.ay + v.vy * (t - sol.ta) };
  }

  function World(cfg) {
    this.cfg = cfg;
    this.diff = DIFFS[cfg.difficulty] || DIFFS.normal;
    this.seed = cfg.seed || Math.floor(Math.random() * 1e9);
    this.rnd = U.makeRng(this.seed);
    this.t = 0;
    var h0 = Math.round(this.rnd.range(0, 360) / 5) * 5 % 360;
    this.own = { x: 0, y: 0, hdg: h0, spd: 6, ordHdg: h0, ordSpd: 6, rate: 0 };
    this.ownHist = [];
    this.contacts = [];
    this.tracks = [];
    this.trackSeq = 0;
    this.torps = [];
    this.torpSeq = 0;
    this.events = [];
    this.rows = [];
    this.blasts = [];
    this.pending = [];
    this.reports = [];
    this.tubes = [1, 2, 3, 4].map(function (n) {
      return { n: n, state: 'READY', t: 0 };
    });
    this.reserve = 4;
    this.crossing = {};
    this.nextSensor = 0;
    this.nextHist = 0;
    this.nextRow = 0;
    this.silent = false;
    this.truthShown = false;
    this.over = false;
    this.spawn(U.clamp(cfg.contacts || 3, 1, 5));
  }

  World.DT = DT;
  World.ROW_DT = ROW_DT;
  World.WF_BINS = WF_BINS;
  World.BAFFLE_HALF = BAFFLE_HALF;
  World.TYPES = TYPES;
  World.DIFFS = DIFFS;
  World.TORP = TORP;
  World.solVel = solVel;
  World.solPos = solPos;

  var P = World.prototype;

  P.emit = function (ev) {
    if (this.silent) return;
    ev.t = this.t;
    this.events.push(ev);
  };
  P.later = function (dt, fn) {
    this.pending.push({ t: this.t + dt, fn: fn });
  };

  P.spawn = function (n) {
    var r = this.rnd;
    var d = this.diff;
    var kinds = d.types.slice();
    // shuffle so the mix differs run to run, while keeping variety
    for (var i = kinds.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var tmp = kinds[i];
      kinds[i] = kinds[j];
      kinds[j] = tmp;
    }
    var bearings = [];
    for (var k = 0; k < n; k++) {
      var key = kinds[k % kinds.length];
      var type = TYPES[key];
      var spd = Math.round(r.range(type.spd[0], type.spd[1]) * 2) / 2;
      var b = 0;
      for (var tries = 0; tries < 60; tries++) {
        b = r.range(0, 360);
        var ok = true;
        for (var q = 0; q < bearings.length; q++) {
          if (Math.abs(U.wrap180(b - bearings[q])) < 25) ok = false;
        }
        // keep contacts out of the initial baffles so they show up at once
        if (Math.abs(U.wrap180(b - this.own.hdg)) > 180 - BAFFLE_HALF - 10) ok = false;
        if (ok) break;
      }
      bearings.push(b);
      var rng = U.clamp(r.range(0.45, 0.78) * detRange(type, spd, 6), 5000, 24000);
      var aob = r.range(30, 150) * r.sign();
      var crs = Math.round(U.wrap360(b + 180 + aob));
      var c = {
        id: k,
        key: key,
        type: type,
        x: Math.sin(b * U.D2R) * rng,
        y: Math.cos(b * U.D2R) * rng,
        crs: crs,
        spd: spd,
        ordCrs: crs,
        ordSpd: spd,
        alive: true,
        sinkT: null,
        se: -99,
        tb: b,
        fluct: r.normal() * 2,
        det: false,
        trackId: null,
        lastDet: -1e9,
        tpk: r.range(type.tpk[0], type.tpk[1]),
        blades: r.int(type.blades[0], type.blades[1]),
        rpmBias: r.range(-2, 2),
        nextMan: null,
        evading: false,
        evadeT: 0,
        trail: [],
      };
      if (type.fishing && d.fishing) c.nextMan = r.range(300, 640);
      else if (r() < d.maneuverP) c.nextMan = r.range(540, 1300);
      this.contacts.push(c);
    }
  };

  // Pre-roll a couple of minutes so the plot opens with history to work on.
  P.preroll = function () {
    this.silent = true;
    var steps = PREROLL / DT;
    for (var i = 0; i < steps; i++) this.step(DT);
    this.silent = false;
    var held = this.tracks.filter(function (tr) {
      return tr.status === 'TRK';
    });
    var names = held.map(function (tr) {
      return tr.name;
    });
    this.emit({
      src: 'SONAR',
      text: 'Holding ' + held.length + ' contact' + (held.length === 1 ? '' : 's') + (names.length ? ': ' + names.join(', ') : '') + '.',
      say: 'Conn, sonar. Holding ' + held.length + ' contact' + (held.length === 1 ? '' : 's') + '.',
      sound: 'contact',
    });
  };

  // ---- stepping --------------------------------------------------------
  P.step = function (dt) {
    this.t += dt;
    this.stepOwn(dt);
    for (var i = 0; i < this.contacts.length; i++) this.stepContact(this.contacts[i], dt);
    for (var j = 0; j < this.torps.length; j++) this.stepTorp(this.torps[j], dt);

    if (this.pending.length) {
      var due = [];
      var keep = [];
      for (var p = 0; p < this.pending.length; p++) {
        (this.pending[p].t <= this.t ? due : keep).push(this.pending[p]);
      }
      this.pending = keep;
      for (var q = 0; q < due.length; q++) due[q].fn.call(this);
    }
    if (this.t >= this.nextSensor) {
      this.sensorStep();
      this.nextSensor += SENSOR_DT;
    }
    if (this.t >= this.nextHist) {
      var o = this.own;
      this.ownHist.push({ t: this.t, x: o.x, y: o.y, h: o.hdg, s: o.spd });
      for (var c = 0; c < this.contacts.length; c++) {
        var ct = this.contacts[c];
        if (ct.alive && this.ownHist.length % 15 === 0) ct.trail.push({ t: this.t, x: ct.x, y: ct.y });
      }
      this.nextHist += HIST_DT;
    }
    if (this.t >= this.nextRow) {
      this.rows.push({ t: this.t, data: this.makeRow() });
      if (this.rows.length > 400) this.rows.splice(0, this.rows.length - 400);
      this.nextRow += ROW_DT;
    }
    this.stepTubes();
    this.checkOver();
  };

  P.stepOwn = function (dt) {
    var o = this.own;
    var rate = U.clamp(0.3 + o.spd * 0.11, 0.4, 2.5);
    var prev = o.hdg;
    o.hdg = U.turnToward(o.hdg, o.ordHdg, rate * dt);
    o.rate = U.wrap180(o.hdg - prev) / dt;
    if (o.spd < o.ordSpd) o.spd = Math.min(o.ordSpd, o.spd + 0.08 * dt);
    else o.spd = Math.max(o.ordSpd, o.spd - 0.12 * dt);
    o.x += Math.sin(o.hdg * U.D2R) * o.spd * KT * dt;
    o.y += Math.cos(o.hdg * U.D2R) * o.spd * KT * dt;
  };

  P.stepContact = function (c, dt) {
    if (!c.alive) return;
    var r = this.rnd;
    if (c.nextMan !== null && this.t >= c.nextMan && !c.evading) {
      c.ordCrs = Math.round(U.wrap360(c.crs + r.sign() * r.range(40, 120)));
      if (c.type.fishing) {
        c.ordSpd = Math.round(r.range(c.type.spd[0], c.type.spd[1]));
        c.nextMan = this.t + r.range(360, 720);
      } else {
        c.nextMan = null;
      }
    }
    if (this.diff.evade && c.type.evade) {
      var near = null;
      var nd = 1e9;
      for (var i = 0; i < this.torps.length; i++) {
        var w = this.torps[i];
        if (w.state === 'DONE') continue;
        var dd = U.dist(w.x, w.y, c.x, c.y);
        if (dd < nd) {
          nd = dd;
          near = w;
        }
      }
      if (!c.evading && near && nd < 6500) {
        c.evading = true;
        c.evadeT = this.t + r.range(10, 25);
      }
      if (c.evading && near && this.t >= c.evadeT) {
        c.ordCrs = U.brg(near.x, near.y, c.x, c.y);
        c.ordSpd = c.type.maxSpd;
      }
    }
    c.crs = U.turnToward(c.crs, c.ordCrs, c.type.turn * dt);
    if (c.spd < c.ordSpd) c.spd = Math.min(c.ordSpd, c.spd + c.type.accel * dt);
    else c.spd = Math.max(c.ordSpd, c.spd - c.type.accel * dt);
    c.x += Math.sin(c.crs * U.D2R) * c.spd * KT * dt;
    c.y += Math.cos(c.crs * U.D2R) * c.spd * KT * dt;
  };

  P.seBase = function (c) {
    var o = this.own;
    var r = U.dist(o.x, o.y, c.x, c.y);
    var b = U.brg(o.x, o.y, c.x, c.y);
    var se = srcLevel(c.type, c.spd) - transLoss(r) - noiseLevel(o.spd) + 2;
    if (Math.abs(U.wrap180(b - o.hdg)) > 180 - BAFFLE_HALF) se -= 22;
    return se;
  };

  P.inBaffles = function (b) {
    return Math.abs(U.wrap180(b - this.own.hdg)) > 180 - BAFFLE_HALF;
  };

  P.bearingSigma = function (se) {
    var o = this.own;
    var s = this.diff.noise * (0.25 + 1.6 * Math.exp(-Math.max(se, 0) / 5));
    s += Math.max(0, o.spd - 12) * 0.06;
    if (Math.abs(o.rate) > 0.3) s += 0.6;
    return s;
  };

  P.sensorStep = function () {
    var self = this;
    var o = this.own;
    var r = this.rnd;
    var d = this.diff;
    var live = this.contacts.filter(function (c) {
      return c.alive;
    });
    live.forEach(function (c) {
      c.fluct = 0.92 * c.fluct + 0.39 * r.normal() * 2.5;
      c.se = self.seBase(c) + c.fluct;
      c.tb = U.brg(o.x, o.y, c.x, c.y);
      // a tracker that already holds a contact rides through shallow fades
      c.det = c.se > (c.trackId !== null ? -2.5 : 0);
      c.masked = false;
    });
    // Bearing crossings: the louder contact masks the weaker one, and the
    // auto-tracker can swap trackers when the two pull apart again.
    for (var i = 0; i < live.length; i++) {
      for (var j = i + 1; j < live.length; j++) {
        var a = live[i];
        var b = live[j];
        var key = a.id + '-' + b.id;
        var sep = Math.abs(U.wrap180(a.tb - b.tb));
        if (sep < 1.3 && a.se > -2 && b.se > -2) {
          var weak = a.se < b.se ? a : b;
          weak.det = false;
          weak.masked = true;
          this.crossing[key] = true;
        } else if (this.crossing[key] && sep > 2.5) {
          delete this.crossing[key];
          if (a.trackId !== null && b.trackId !== null && r() < d.swapP) {
            var tid = a.trackId;
            a.trackId = b.trackId;
            b.trackId = tid;
          }
        }
      }
    }
    live.forEach(function (c) {
      if (!c.det) return;
      if (c.trackId !== null && d.reinitPerMin && r() < (d.reinitPerMin * SENSOR_DT) / 60) c.trackId = null;
      var tr = c.trackId !== null ? self.trackById(c.trackId) : null;
      if (!tr) {
        tr = self.newTrack(c);
        c.trackId = tr.id;
      }
      var sigma = self.bearingSigma(c.se);
      tr.samples.push({
        t: self.t,
        b: U.wrap360(c.tb + r.normal() * sigma),
        ox: o.x,
        oy: o.y,
        oh: o.hdg,
        cid: c.id,
        se: c.se,
      });
      tr.version++;
      c.lastDet = self.t;
    });
    live.forEach(function (c) {
      if (c.trackId !== null && self.t - c.lastDet > LOST_AFTER) c.trackId = null;
    });
    this.tracks.forEach(function (tr) {
      var last = tr.samples.length ? tr.samples[tr.samples.length - 1] : null;
      var age = last ? self.t - last.t : 1e9;
      var st = tr.sunk ? 'SUNK' : age < 12 ? 'TRK' : age < LOST_AFTER ? 'HOLD' : 'LOST';
      if (st === 'LOST' && tr.status !== 'LOST' && tr.status !== 'SUNK' && last) {
        self.emit({
          src: 'SONAR',
          text: 'Lost contact ' + tr.name + ', last bearing ' + U.fmtBrg(last.b) + '.',
          say: 'Conn, sonar. Lost contact ' + U.sayTrack(tr.name) + '.',
          level: 'warn',
        });
      }
      tr.status = st;
    });
  };

  // ---- tracks ----------------------------------------------------------
  P.trackById = function (id) {
    for (var i = 0; i < this.tracks.length; i++) if (this.tracks[i].id === id) return this.tracks[i];
    return null;
  };

  P.newTrack = function (c) {
    var id = ++this.trackSeq;
    var tr = {
      id: id,
      name: 'S' + id,
      color: TRACK_COLORS[(id - 1) % TRACK_COLORS.length],
      samples: [],
      status: 'TRK',
      sol: null,
      sunk: false,
      version: 0,
      created: this.t,
    };
    this.tracks.push(tr);
    this.emit({
      src: 'SONAR',
      text: 'New contact bearing ' + U.fmtBrg(c.tb) + ', designated ' + tr.name + '.',
      say: 'Conn, sonar. New contact bearing ' + U.sayBrg(c.tb) + '. Designate ' + U.sayTrack(tr.name) + '.',
      sound: 'contact',
      trackId: id,
    });
    return tr;
  };

  P.lastSample = function (tr) {
    return tr.samples.length ? tr.samples[tr.samples.length - 1] : null;
  };

  // Bearing lines for the geo plot: one per interval, steadied by averaging
  // the samples around the representative time.
  P.lines = function (tr, interval) {
    var key = tr.version + ':' + interval + ':' + Math.floor(this.t / interval);
    if (tr._lk === key) return tr._lines;
    var s = tr.samples;
    var out = [];
    var i = 0;
    while (i < s.length) {
      var bucket = Math.floor(s[i].t / interval);
      var end = (bucket + 1) * interval;
      var mid = (bucket + 0.5) * interval;
      var best = i;
      var j = i;
      while (j < s.length && Math.floor(s[j].t / interval) === bucket) {
        if (Math.abs(s[j].t - mid) < Math.abs(s[best].t - mid)) best = j;
        j++;
      }
      if (end <= this.t) {
        var bs = [];
        for (var k = Math.max(0, best - 4); k <= Math.min(s.length - 1, best + 4); k++) {
          if (Math.abs(s[k].t - s[best].t) <= 9) bs.push(s[k].b);
        }
        var sm = s[best];
        out.push({ t: sm.t, ox: sm.ox, oy: sm.oy, b: U.circMean(bs), idx: best });
      }
      i = j;
    }
    tr._lk = key;
    tr._lines = out;
    return out;
  };

  // Bearing rate in degrees per minute over the last two minutes.
  P.bearingRate = function (tr) {
    if (tr._brk === tr.version) return tr._br;
    var s = tr.samples;
    var res = null;
    if (s.length >= 6) {
      var tEnd = s[s.length - 1].t;
      var pts = [];
      var ref = null;
      for (var i = s.length - 1; i >= 0 && s[i].t >= tEnd - 120; i--) {
        if (ref === null) ref = s[i].b;
        pts.push({ t: s[i].t - tEnd, b: U.wrap180(s[i].b - ref) });
      }
      if (pts.length >= 6) {
        var n = pts.length,
          st = 0,
          sb = 0,
          stt = 0,
          stb = 0;
        pts.forEach(function (p) {
          st += p.t;
          sb += p.b;
          stt += p.t * p.t;
          stb += p.t * p.b;
        });
        var den = n * stt - st * st;
        if (Math.abs(den) > 1e-6) res = ((n * stb - st * sb) / den) * 60;
      }
    }
    tr._brk = tr.version;
    tr._br = res;
    return res;
  };

  P.ownAt = function (t) {
    var h = this.ownHist;
    if (!h.length || t >= h[h.length - 1].t) return { x: this.own.x, y: this.own.y, h: this.own.hdg };
    if (t <= h[0].t) return { x: h[0].x, y: h[0].y, h: h[0].h };
    var lo = 0,
      hi = h.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (h[mid].t <= t) lo = mid;
      else hi = mid;
    }
    var f = (t - h[lo].t) / (h[hi].t - h[lo].t);
    return { x: U.lerp(h[lo].x, h[hi].x, f), y: U.lerp(h[lo].y, h[hi].y, f), h: h[lo].h };
  };

  // Everything the UI needs to know about a track's ruler solution.
  P.solInfo = function (tr) {
    var sol = tr && tr.sol;
    if (!sol) return null;
    var v = solVel(sol);
    if (!v) return { valid: false };
    var o = this.own;
    var pos = solPos(sol, this.t);
    var info = {
      valid: true,
      v: v,
      crs: U.wrap360(Math.atan2(v.vx, v.vy) * U.R2D),
      spd: Math.hypot(v.vx, v.vy) / KT,
      pos: pos,
      rng: U.dist(o.x, o.y, pos.x, pos.y),
      brg: U.brg(o.x, o.y, pos.x, pos.y),
    };
    var rk = tr.version + ':' + sol.rev;
    if (tr._rk !== rk) {
      var s = tr.samples;
      var res = new Array(s.length);
      var sum = 0,
        sq = 0,
        h0 = s.length ? s[0].oh : 0,
        spread = 0;
      for (var i = 0; i < s.length; i++) {
        var p = solPos(sol, s[i].t);
        var e = U.wrap180(s[i].b - U.brg(s[i].ox, s[i].oy, p.x, p.y));
        res[i] = e;
        sum += e;
        sq += e * e;
        spread = Math.max(spread, Math.abs(U.wrap180(s[i].oh - h0)));
      }
      var n = s.length || 1;
      // compare the mean residual of the oldest and newest thirds to spot drift
      var third = Math.max(1, Math.floor(s.length / 3));
      var m1 = 0,
        m2 = 0;
      for (var a = 0; a < third && a < s.length; a++) m1 += res[a];
      for (var b = Math.max(0, s.length - third); b < s.length; b++) m2 += res[b];
      tr._res = res;
      tr._stats = {
        rms: Math.sqrt(sq / n),
        mean: sum / n,
        n: s.length,
        drift: s.length >= 9 ? m2 / third - m1 / third : 0,
        spread: spread,
      };
      tr._rk = rk;
    }
    info.res = tr._res;
    info.rms = tr._stats.rms;
    info.mean = tr._stats.mean;
    info.drift = tr._stats.drift;
    info.legs = tr._stats.spread > 20 ? 2 : 1;
    return info;
  };

  P.setSol = function (tr, sol) {
    sol.rev = (tr.sol && tr.sol.rev ? tr.sol.rev : 0) + 1;
    tr.sol = sol;
  };

  // Ruler fine-tuning, used by the solution panel buttons and keys.
  P.adjCourse = function (tr, d) {
    var v = solVel(tr.sol);
    if (!v) return;
    var dt = tr.sol.tb - tr.sol.ta;
    var a = d * U.D2R;
    var vx = v.vx * Math.cos(a) + v.vy * Math.sin(a);
    var vy = -v.vx * Math.sin(a) + v.vy * Math.cos(a);
    this.setSol(tr, { ta: tr.sol.ta, ax: tr.sol.ax, ay: tr.sol.ay, tb: tr.sol.tb, bx: tr.sol.ax + vx * dt, by: tr.sol.ay + vy * dt });
  };
  P.adjSpeed = function (tr, dk) {
    var v = solVel(tr.sol);
    if (!v) return;
    var sp = Math.hypot(v.vx, v.vy);
    var ns = Math.max(0, sp + dk * KT);
    var f = sp > 1e-6 ? ns / sp : 0;
    var dt = tr.sol.tb - tr.sol.ta;
    this.setSol(tr, { ta: tr.sol.ta, ax: tr.sol.ax, ay: tr.sol.ay, tb: tr.sol.tb, bx: tr.sol.ax + v.vx * f * dt, by: tr.sol.ay + v.vy * f * dt });
  };
  // Slide both ruler ends out or in along their own-ship lines of sight.
  P.adjRange = function (tr, f) {
    var s = tr.sol;
    if (!s) return;
    var oa = this.ownAt(s.ta);
    var ob = this.ownAt(s.tb);
    this.setSol(tr, {
      ta: s.ta,
      ax: oa.x + (s.ax - oa.x) * f,
      ay: oa.y + (s.ay - oa.y) * f,
      tb: s.tb,
      bx: ob.x + (s.bx - ob.x) * f,
      by: ob.y + (s.by - ob.y) * f,
    });
  };

  P.merge = function (ids) {
    var self = this;
    var trs = ids
      .map(function (id) {
        return self.trackById(id);
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.id - b.id;
      });
    if (trs.length < 2) return null;
    var keep = trs[0];
    for (var i = 1; i < trs.length; i++) {
      var o = trs[i];
      keep.samples = keep.samples.concat(o.samples);
      if (!keep.sol && o.sol) keep.sol = o.sol;
      keep.sunk = keep.sunk || o.sunk;
      this.contacts.forEach(function (c) {
        if (c.trackId === o.id) c.trackId = keep.id;
      });
      this.torps.forEach(function (w) {
        if (w.trackId === o.id) w.trackId = keep.id;
      });
      this.tracks.splice(this.tracks.indexOf(o), 1);
    }
    keep.samples.sort(function (a, b) {
      return a.t - b.t;
    });
    keep.version++;
    if (keep.sol) keep.sol.rev++;
    var last = this.lastSample(keep);
    keep.status = keep.sunk ? 'SUNK' : last && this.t - last.t < 12 ? 'TRK' : last && this.t - last.t < LOST_AFTER ? 'HOLD' : 'LOST';
    this.emit({
      src: 'TMA',
      text: 'Merged ' + trs.map(function (t) { return t.name; }).join(' + ') + ' into ' + keep.name + '.',
    });
    return keep;
  };

  P.split = function (id, t) {
    var tr = this.trackById(id);
    if (!tr) return null;
    var before = tr.samples.filter(function (s) {
      return s.t < t;
    });
    var after = tr.samples.filter(function (s) {
      return s.t >= t;
    });
    if (!before.length || !after.length) return null;
    var nid = ++this.trackSeq;
    var nt = {
      id: nid,
      name: 'S' + nid,
      color: TRACK_COLORS[(nid - 1) % TRACK_COLORS.length],
      samples: after,
      status: tr.status,
      sol: null,
      sunk: false,
      version: 0,
      created: this.t,
    };
    tr.samples = before;
    tr.version++;
    if (tr.sol) tr.sol.rev++;
    this.tracks.push(nt);
    this.contacts.forEach(function (c) {
      if (c.trackId === tr.id) c.trackId = nid;
    });
    var lb = before[before.length - 1];
    tr.status = tr.sunk ? 'SUNK' : this.t - lb.t < 12 ? 'TRK' : this.t - lb.t < LOST_AFTER ? 'HOLD' : 'LOST';
    this.emit({
      src: 'TMA',
      text: 'Split ' + tr.name + ' at ' + U.fmtClock(t) + '. Later data is now ' + nt.name + '.',
    });
    return nt;
  };

  P.drop = function (id) {
    var tr = this.trackById(id);
    if (!tr) return;
    this.tracks.splice(this.tracks.indexOf(tr), 1);
    this.contacts.forEach(function (c) {
      if (c.trackId === id) c.trackId = null;
    });
    this.emit({ src: 'TMA', text: 'Dropped track ' + tr.name + '.' });
  };

  // Narrowband / DEMON classification once a track has some history.
  P.demon = function (tr) {
    var last = this.lastSample(tr);
    if (!last) return null;
    var span = last.t - tr.samples[0].t;
    if (span < 90) return { pending: true, need: 90 - span };
    var c = this.contacts[last.cid];
    var rpm = Math.max(0, c.spd * c.tpk + c.rpmBias);
    var out = { shafts: c.type.shafts, blades: c.blades, rpm: Math.round(rpm) };
    if (this.diff.demon !== 'raw') {
      out.cls = c.type.name;
      out.tpk = c.type.tpk;
    }
    if (this.diff.demon === 'full') out.estSpd = rpm / ((c.type.tpk[0] + c.type.tpk[1]) / 2);
    return out;
  };

  // ---- fire control ----------------------------------------------------
  P.presets = function (tr, enableOffset) {
    if (!tr) return null;
    var o = this.own;
    var s = TORP.spdKts * KT;
    var info = this.solInfo(tr);
    if (info && info.valid) {
      var p = info.pos;
      var v = info.v;
      var tgo = U.interceptTime(p.x - o.x, p.y - o.y, v.vx, v.vy, s);
      var stern = false;
      if (tgo === null) {
        tgo = info.rng / s;
        stern = true;
      }
      var ix = p.x + v.vx * tgo;
      var iy = p.y + v.vy * tgo;
      var idist = s * tgo;
      return {
        mode: 'SOLUTION',
        gyro: U.brg(o.x, o.y, ix, iy),
        ix: ix,
        iy: iy,
        idist: idist,
        tgo: tgo,
        enable: Math.max(800, idist - enableOffset),
        stern: stern,
        outOfRange: idist > TORP.maxRun * 0.9,
      };
    }
    var last = this.lastSample(tr);
    if (!last) return null;
    return { mode: 'SNAP', gyro: last.b, idist: null, tgo: null, enable: 1500 };
  };

  P.readyTube = function () {
    for (var i = 0; i < this.tubes.length; i++) if (this.tubes[i].state === 'READY') return this.tubes[i];
    return null;
  };

  P.fire = function (tr, enableOffset) {
    var tube = this.readyTube();
    if (!tube || !tr) return null;
    var pre = this.presets(tr, enableOffset);
    if (!pre) return null;
    var o = this.own;
    var info = this.solInfo(tr);
    var last = this.lastSample(tr);
    var tgt = last ? this.contacts[last.cid] : null;
    var w = {
      id: ++this.torpSeq,
      name: 'W' + (this.torpSeq),
      tube: tube.n,
      trackId: tr.id,
      trackName: tr.name,
      x: o.x,
      y: o.y,
      hdg: o.hdg,
      gyro: pre.gyro,
      enable: pre.enable,
      run: 0,
      searchRun: 0,
      searchT0: 0,
      searchBase: pre.gyro,
      state: 'RTE',
      wire: true,
      tgt: null,
      lostT: 0,
      trail: [{ x: o.x, y: o.y }],
      launchT: this.t,
      intendedCid: tgt ? tgt.id : null,
      launch: {
        mode: pre.mode,
        sol: info && info.valid ? { crs: info.crs, spd: info.spd, rng: info.rng, brg: info.brg } : null,
        truth: tgt
          ? {
              crs: tgt.crs,
              spd: tgt.spd,
              rng: U.dist(o.x, o.y, tgt.x, tgt.y),
              brg: U.brg(o.x, o.y, tgt.x, tgt.y),
              key: tgt.key,
            }
          : null,
        truthShown: this.truthShown,
      },
    };
    this.torps.push(w);
    tube.state = 'EMPTY';
    tube.t = this.t;
    this.emit({
      src: 'WEAPONS',
      text: 'Tube ' + tube.n + ' fired. ' + w.name + ' assigned ' + tr.name + ', gyro ' + U.fmtBrg(pre.gyro) + (pre.mode === 'SNAP' ? ' (snap shot down the bearing).' : ', enable at ' + U.fmtKyd(pre.enable) + ' kyd.'),
      say: 'Tube ' + tube.n + ' fired electrically.',
      sound: 'launch',
      level: 'alert',
    });
    this.later(6, function () {
      if (w.state !== 'DONE') {
        this.emit({ src: 'SONAR', text: w.name + ' running hot, straight and normal.', say: 'Unit is running hot, straight and normal.' });
      }
    });
    return w;
  };

  // Re-aim a weapon over the wire using the latest solution of its track.
  P.updateWire = function (w, enableOffset) {
    if (!w.wire || w.state === 'DONE' || w.state === 'HOMING') return false;
    var tr = this.trackById(w.trackId);
    var info = tr && this.solInfo(tr);
    if (!info || !info.valid) return false;
    var s = TORP.spdKts * KT;
    var p = info.pos;
    var tgo = U.interceptTime(p.x - w.x, p.y - w.y, info.v.vx, info.v.vy, s);
    if (tgo === null) tgo = U.dist(w.x, w.y, p.x, p.y) / s;
    var ix = p.x + info.v.vx * tgo;
    var iy = p.y + info.v.vy * tgo;
    var g = U.brg(w.x, w.y, ix, iy);
    var togo = s * tgo;
    if (w.state === 'RTE') {
      w.gyro = g;
      w.enable = w.run + Math.max(300, togo - enableOffset);
    } else {
      w.searchBase = g;
      w.searchT0 = this.t;
      w.searchRun = 0;
    }
    this.emit({ src: 'WEAPONS', text: w.name + ' presets updated over the wire: course ' + U.fmtBrg(g) + ', ' + U.fmtKyd(togo) + ' kyd to go.' });
    return true;
  };

  P.enableNow = function (w) {
    if (!w.wire || w.state !== 'RTE') return false;
    w.enable = w.run;
    return true;
  };

  P.acqRange = function (c) {
    return U.clamp(1400 + (srcLevel(c.type, c.spd) - 145) * 120, 1200, 3600);
  };

  P.stepTorp = function (w, dt) {
    if (w.state === 'DONE') return;
    var s = TORP.spdKts * KT;
    var hcmd = w.gyro;
    if (w.state === 'RTE' && w.run >= w.enable) {
      w.state = 'SEARCH';
      w.searchT0 = this.t;
      w.searchBase = w.hdg;
      w.searchRun = 0;
      this.emit({ src: 'WEAPONS', text: w.name + ' enabled, searching.', say: 'Unit ' + w.id + ' enabled.' });
    }
    if (w.state === 'SEARCH') {
      var c = this.acquire(w);
      if (c) {
        w.state = 'HOMING';
        w.tgt = c.id;
        w.lostT = 0;
        this.emit({
          src: 'WEAPONS',
          text: w.name + ' has acquired. Homing, bearing ' + U.fmtBrg(U.brg(this.own.x, this.own.y, c.x, c.y)) + '.',
          say: 'Unit ' + w.id + ' has acquired.',
          level: 'alert',
          sound: 'acquire',
        });
      } else if (w.searchRun < 4500) {
        hcmd = w.searchBase + 30 * Math.sin((2 * Math.PI * (this.t - w.searchT0)) / 24);
      } else {
        hcmd = w.hdg + 40; // re-attack circle
      }
    }
    if (w.state === 'HOMING') {
      var tc = this.contacts[w.tgt];
      var rel = U.wrap180(U.brg(w.x, w.y, tc.x, tc.y) - w.hdg);
      var r = U.dist(w.x, w.y, tc.x, tc.y);
      if (!tc.alive || Math.abs(rel) > 75 || r > this.acqRange(tc) * 1.6) w.lostT += dt;
      else w.lostT = 0;
      if (w.lostT > 4) {
        w.state = 'SEARCH';
        w.searchBase = w.hdg;
        w.searchT0 = this.t;
        w.searchRun = 0;
        this.emit({ src: 'WEAPONS', text: w.name + ' lost acquisition, re-searching.', level: 'warn' });
      } else {
        var cvx = Math.sin(tc.crs * U.D2R) * tc.spd * KT;
        var cvy = Math.cos(tc.crs * U.D2R) * tc.spd * KT;
        var tgo = U.interceptTime(tc.x - w.x, tc.y - w.y, cvx, cvy, s);
        hcmd = tgo ? U.brg(w.x, w.y, tc.x + cvx * tgo, tc.y + cvy * tgo) : U.brg(w.x, w.y, tc.x, tc.y);
      }
    }
    var rate = w.state === 'HOMING' ? TORP.turnHoming : TORP.turn;
    w.hdg = U.turnToward(w.hdg, U.wrap360(hcmd), rate * dt);
    var px = w.x,
      py = w.y;
    w.x += Math.sin(w.hdg * U.D2R) * s * dt;
    w.y += Math.cos(w.hdg * U.D2R) * s * dt;
    w.run += s * dt;
    if (w.state === 'SEARCH') w.searchRun += s * dt;
    if (Math.floor(w.run / 150) !== Math.floor((w.run - s * dt) / 150)) w.trail.push({ x: w.x, y: w.y });

    if (w.wire && this.own.spd > 20) {
      w.wire = false;
      this.emit({ src: 'WEAPONS', text: 'Wire parted on ' + w.name + ' (own ship above 20 kts).', level: 'warn' });
    }

    // Proximity fuze: closest approach along this step's path.
    for (var i = 0; i < this.contacts.length; i++) {
      var ct = this.contacts[i];
      if (!ct.alive || w.run < 400) continue;
      var dx = w.x - px,
        dy = w.y - py;
      var L = dx * dx + dy * dy;
      var f = L > 0 ? U.clamp(((ct.x - px) * dx + (ct.y - py) * dy) / L, 0, 1) : 0;
      if (U.dist(px + dx * f, py + dy * f, ct.x, ct.y) < ct.type.hitR) {
        this.detonate(w, ct);
        return;
      }
    }
    if (w.run >= TORP.maxRun) {
      w.state = 'DONE';
      w.doneT = this.t;
      w.result = 'MISS';
      this.emit({ src: 'WEAPONS', text: w.name + ' run complete. No detonation.', say: 'Unit ' + w.id + ' has shut down. No detonation.', level: 'warn' });
      this.report(w, null);
    }
  };

  P.acquire = function (w) {
    var best = null;
    var bd = 1e9;
    for (var i = 0; i < this.contacts.length; i++) {
      var c = this.contacts[i];
      if (!c.alive) continue;
      var r = U.dist(w.x, w.y, c.x, c.y);
      var rel = Math.abs(U.wrap180(U.brg(w.x, w.y, c.x, c.y) - w.hdg));
      if (rel <= TORP.seekerHalf && r <= this.acqRange(c) && r < bd) {
        bd = r;
        best = c;
      }
    }
    return best;
  };

  P.detonate = function (w, c) {
    var o = this.own;
    w.state = 'DONE';
    w.doneT = this.t;
    w.result = c.id === w.intendedCid ? 'HIT' : 'HIT_OTHER';
    w.x = c.x;
    w.y = c.y;
    c.alive = false;
    c.det = false;
    c.sinkT = this.t;
    var r = U.dist(o.x, o.y, c.x, c.y);
    var heard = (r * 0.9144) / 1500; // sound travel time
    var blast = { x: c.x, y: c.y, t: this.t, heardT: this.t + heard, cid: c.id };
    this.blasts.push(blast);
    var self = this;
    this.tracks.forEach(function (tr) {
      var last = self.lastSample(tr);
      if (last && last.cid === c.id && self.t - last.t < LOST_AFTER) {
        tr.sunk = true;
        tr.status = 'SUNK';
      }
    });
    c.trackId = null;
    this.later(heard, function () {
      var b = U.brg(this.own.x, this.own.y, c.x, c.y);
      this.emit({
        src: 'SONAR',
        text: 'Explosion bearing ' + U.fmtBrg(b) + '!',
        say: 'Explosion, bearing ' + U.sayBrg(b) + '!',
        sound: 'boom',
        level: 'alert',
      });
      this.later(14, function () {
        this.emit({
          src: 'SONAR',
          text: 'Breaking up noises bearing ' + U.fmtBrg(b) + '. ' + c.type.desc + ' is going down.',
          say: 'Conn, sonar. Breaking up noises, bearing ' + U.sayBrg(b) + '.',
        });
        this.report(w, c);
      });
    });
  };

  P.report = function (w, hitC) {
    var L = w.launch;
    var rep = {
      w: w.name,
      track: w.trackName,
      mode: L.mode,
      result: w.result,
      hitType: hitC ? hitC.type.desc : null,
      intendedType: L.truth ? TYPES[L.truth.key].desc : null,
      truthShown: L.truthShown,
      sol: L.sol,
      truth: L.truth,
      score: 0,
      grade: '-',
    };
    if (L.sol && L.truth) {
      rep.errCrs = Math.abs(U.wrap180(L.sol.crs - L.truth.crs));
      rep.errSpd = Math.abs(L.sol.spd - L.truth.spd);
      rep.errRng = (Math.abs(L.sol.rng - L.truth.rng) / L.truth.rng) * 100;
      rep.score = Math.round(U.clamp(100 - rep.errCrs * 1.0 - rep.errSpd * 4 - rep.errRng * 1.2, 0, 100));
      rep.grade = gradeOf(rep.score);
    }
    this.reports.push(rep);
    this.emit({ src: 'FIRE CONTROL', kind: 'report', report: rep, text: reportLine(rep), level: rep.result === 'HIT' ? 'good' : 'warn' });
  };

  function gradeOf(score) {
    return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  }
  World.gradeOf = gradeOf;

  function reportLine(rep) {
    var head =
      rep.result === 'HIT'
        ? rep.w + ' HIT ' + rep.track + ' (' + rep.hitType + ').'
        : rep.result === 'HIT_OTHER'
          ? rep.w + ' hit the wrong ship: ' + rep.hitType + ', not ' + rep.track + '.'
          : rep.w + ' missed ' + rep.track + '.';
    if (rep.mode === 'SNAP' || !rep.sol) return head + ' Snap shot, no solution to grade.';
    return head + ' Solution at launch: course off ' + rep.errCrs.toFixed(0) + ' deg, speed off ' + rep.errSpd.toFixed(1) + ' kt, range off ' + rep.errRng.toFixed(0) + '%. Grade ' + rep.grade + '.';
  }

  P.stepTubes = function () {
    for (var i = 0; i < this.tubes.length; i++) {
      var tb = this.tubes[i];
      if (tb.state === 'EMPTY' && this.reserve > 0 && this.t - tb.t > 5) {
        tb.state = 'RELOAD';
        tb.t = this.t + 90;
        this.reserve--;
      } else if (tb.state === 'RELOAD' && this.t >= tb.t) {
        tb.state = 'READY';
        this.emit({ src: 'WEAPONS', text: 'Tube ' + tb.n + ' reloaded and ready.' });
      }
    }
  };

  P.checkOver = function () {
    if (this.over) return;
    var alive = this.contacts.some(function (c) {
      return c.alive;
    });
    var running = this.torps.some(function (w) {
      return w.state !== 'DONE';
    });
    if (!alive && !running && !this.pending.length) {
      this.over = true;
      this.emit({ src: 'CONN', kind: 'over', text: 'All contacts destroyed. Exercise complete.', say: 'All contacts destroyed. Well done.', level: 'good' });
    }
  };

  // ---- waterfall -------------------------------------------------------
  function addGauss(row, b, w, amp) {
    var res = 360 / WF_BINS;
    var c = U.wrap360(b) / res;
    var span = Math.ceil((3 * w) / res);
    var ci = Math.round(c);
    for (var k = -span; k <= span; k++) {
      var i = ci + k;
      var d = (i - c) * res;
      var idx = ((i % WF_BINS) + WF_BINS) % WF_BINS;
      row[idx] += amp * Math.exp(-(d * d) / (2 * w * w));
    }
  }

  P.makeRow = function () {
    var row = new Float32Array(WF_BINS);
    var r = this.rnd;
    var o = this.own;
    var base = 0.075 + 0.006 * o.spd;
    for (var i = 0; i < WF_BINS; i++) row[i] = base * -Math.log(1 - r() * 0.999);
    // own-ship noise smeared across the baffles
    var astern = U.wrap360(o.hdg + 180);
    var res = 360 / WF_BINS;
    for (var k = -BAFFLE_HALF / res; k <= BAFFLE_HALF / res; k++) {
      var idx = ((Math.round(astern / res + k) % WF_BINS) + WF_BINS) % WF_BINS;
      row[idx] += (0.05 + 0.006 * o.spd) * (1 - Math.abs(k * res) / BAFFLE_HALF) * (0.6 + r() * 0.8);
    }
    for (var c = 0; c < this.contacts.length; c++) {
      var ct = this.contacts[c];
      var b = U.brg(o.x, o.y, ct.x, ct.y);
      if (ct.alive) {
        var amp = 1 / (1 + Math.exp(-(ct.se + 3) / 2.5));
        addGauss(row, b + r.normal() * 0.25, 0.9, amp * (0.7 + 0.6 * r()));
      } else if (ct.sinkT !== null) {
        var bl = this.blastFor(ct.id);
        if (bl && this.t >= bl.heardT) {
          var since = this.t - bl.heardT;
          if (since < 150) addGauss(row, b, 1.6, 1.1 * Math.exp(-since / 50) * (r() < 0.55 ? 1 : 0.25));
        }
      }
    }
    for (var w = 0; w < this.torps.length; w++) {
      var tp = this.torps[w];
      if (tp.state !== 'DONE') addGauss(row, U.brg(o.x, o.y, tp.x, tp.y), 0.6, 0.95);
    }
    for (var q = 0; q < this.blasts.length; q++) {
      var bz = this.blasts[q];
      if (bz.heardT <= this.t && bz.heardT > this.t - ROW_DT) {
        for (var z = 0; z < WF_BINS; z++) row[z] += 0.6;
        addGauss(row, U.brg(o.x, o.y, bz.x, bz.y), 3, 2);
      }
    }
    return row;
  };

  P.blastFor = function (cid) {
    for (var i = 0; i < this.blasts.length; i++) if (this.blasts[i].cid === cid) return this.blasts[i];
    return null;
  };

  // Truth for the end-of-exercise debrief.
  P.debrief = function () {
    var self = this;
    var o = this.own;
    return this.contacts.map(function (c) {
      // the track that holds this contact's latest data, preferring one with a solution
      var best = null;
      self.tracks.forEach(function (tr) {
        var last = self.lastSample(tr);
        if (!last || last.cid !== c.id) return;
        var info = self.solInfo(tr);
        var cand = { tr: tr, info: info && info.valid ? info : null, n: tr.samples.length };
        if (!best || (cand.info && !best.info) || (!!cand.info === !!best.info && cand.n > best.n)) best = cand;
      });
      var rng = U.dist(o.x, o.y, c.x, c.y);
      var row = {
        type: c.type.desc,
        crs: c.crs,
        spd: c.spd,
        rng: rng,
        alive: c.alive,
        track: best ? best.tr.name : null,
      };
      if (best && best.info && c.alive) {
        row.solCrs = best.info.crs;
        row.solSpd = best.info.spd;
        row.solRng = best.info.rng;
      }
      return row;
    });
  };

  TMA.World = World;
})();
