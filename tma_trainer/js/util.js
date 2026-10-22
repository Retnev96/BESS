/* Shared math, units and formatting helpers. Everything hangs off window.TMA. */
'use strict';
var TMA = (window.TMA = window.TMA || {});

(function () {
  // Positions are in yards, time in seconds, headings/bearings in degrees true.
  var KT = 2025.372 / 3600; // yards per second in one knot
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  function wrap360(a) {
    a %= 360;
    return a < 0 ? a + 360 : a;
  }
  function wrap180(a) {
    a = wrap360(a);
    return a > 180 ? a - 360 : a;
  }
  // Bearing from (x1,y1) to (x2,y2): x is east, y is north.
  function brg(x1, y1, x2, y2) {
    return wrap360(Math.atan2(x2 - x1, y2 - y1) * R2D);
  }
  function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function lerp(a, b, f) {
    return a + (b - a) * f;
  }
  // Step a heading toward a target by at most maxStep degrees, shortest way.
  function turnToward(cur, target, maxStep) {
    var d = wrap180(target - cur);
    if (Math.abs(d) <= maxStep) return wrap360(target);
    return wrap360(cur + Math.sign(d) * maxStep);
  }
  function circMean(degs) {
    var s = 0,
      c = 0;
    for (var i = 0; i < degs.length; i++) {
      s += Math.sin(degs[i] * D2R);
      c += Math.cos(degs[i] * D2R);
    }
    return wrap360(Math.atan2(s, c) * R2D);
  }

  // Small seeded PRNG so a scenario can be replayed from its seed.
  function makeRng(seed) {
    var a = seed >>> 0;
    var spare = null;
    function rnd() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    rnd.range = function (lo, hi) {
      return lo + (hi - lo) * rnd();
    };
    rnd.int = function (lo, hi) {
      return Math.floor(rnd.range(lo, hi + 1));
    };
    rnd.pick = function (arr) {
      return arr[Math.floor(rnd() * arr.length)];
    };
    rnd.sign = function () {
      return rnd() < 0.5 ? -1 : 1;
    };
    rnd.normal = function () {
      if (spare !== null) {
        var s = spare;
        spare = null;
        return s;
      }
      var u = 0,
        v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      var m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    };
    return rnd;
  }

  function pad(n, w) {
    var s = String(Math.floor(n));
    while (s.length < w) s = '0' + s;
    return s;
  }
  function fmtBrg(b) {
    return pad(Math.round(wrap360(b)) % 360, 3);
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(sec / 3600, 2) + ':' + pad((sec % 3600) / 60, 2) + ':' + pad(sec % 60, 2);
  }
  function fmtMinSec(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(sec / 60, 2) + ':' + pad(sec % 60, 2);
  }
  function fmtKyd(yd) {
    return (yd / 1000).toFixed(1);
  }

  // Spoken forms for the voice callouts ("zero four five", "sierra three").
  var DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  function sayBrg(b) {
    return fmtBrg(b)
      .split('')
      .map(function (d) {
        return DIGITS[+d];
      })
      .join(' ');
  }
  function sayTrack(name) {
    return name.replace(/^S/, 'sierra ').replace(/^W/, 'unit ');
  }

  // Intercept for a constant-velocity target: returns time to go or null.
  function interceptTime(dx, dy, vx, vy, s) {
    var a = vx * vx + vy * vy - s * s;
    var b = 2 * (dx * vx + dy * vy);
    var c = dx * dx + dy * dy;
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) < 1e-9) return null;
      var t0 = -c / b;
      return t0 > 0 ? t0 : null;
    }
    var disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t1 = (-b - sq) / (2 * a);
    var t2 = (-b + sq) / (2 * a);
    var best = null;
    if (t1 > 0) best = t1;
    if (t2 > 0 && (best === null || t2 < best)) best = t2;
    return best;
  }

  TMA.U = {
    KT: KT,
    D2R: D2R,
    R2D: R2D,
    wrap360: wrap360,
    wrap180: wrap180,
    brg: brg,
    dist: dist,
    clamp: clamp,
    lerp: lerp,
    turnToward: turnToward,
    circMean: circMean,
    makeRng: makeRng,
    pad: pad,
    fmtBrg: fmtBrg,
    fmtClock: fmtClock,
    fmtMinSec: fmtMinSec,
    fmtKyd: fmtKyd,
    sayBrg: sayBrg,
    sayTrack: sayTrack,
    interceptTime: interceptTime,
  };
})();
