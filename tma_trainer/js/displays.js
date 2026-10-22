/* Sonar waterfall, dot stack and the own-ship heading dial. */
'use strict';
(function () {
  var U = TMA.U;
  var World = TMA.World;
  var COL = TMA.COL;
  var FD = TMA.FONT_DATA;
  var FL = TMA.FONT_LABEL;

  function fitCanvas(obj) {
    var r = obj.cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(10, Math.round(r.width));
    var h = Math.max(10, Math.round(r.height));
    if (w !== obj.W || h !== obj.H || dpr !== obj.dpr) {
      obj.W = w;
      obj.H = h;
      obj.dpr = dpr;
      obj.cv.width = Math.round(w * dpr);
      obj.cv.height = Math.round(h * dpr);
    }
    obj.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- waterfall -----------------------------------------------------------
  var ROWS = 300;

  function Waterfall(cv, app) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.app = app;
    this.off = document.createElement('canvas');
    this.off.width = World.WF_BINS;
    this.off.height = ROWS;
    this.octx = this.off.getContext('2d');
    this.rowImg = this.octx.createImageData(World.WF_BINS, 1);
    this.lut = buildLut();
    this.mouse = null;
    this.reset();
    var self = this;
    cv.addEventListener('pointermove', function (e) {
      self.mouse = self.local(e);
    });
    cv.addEventListener('pointerleave', function () {
      self.mouse = null;
    });
    cv.addEventListener('pointerdown', function (e) {
      self.onClick(self.local(e));
    });
  }

  // phosphor ramp: black, deep green, green, pale yellow-white
  function buildLut() {
    var stops = [
      [0, 2, 8, 6],
      [0.25, 4, 48, 26],
      [0.5, 22, 140, 70],
      [0.75, 92, 242, 154],
      [0.92, 214, 255, 196],
      [1, 255, 255, 235],
    ];
    var lut = new Uint8ClampedArray(256 * 3);
    for (var i = 0; i < 256; i++) {
      var v = i / 255;
      var k = 0;
      while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
      var a = stops[k],
        b = stops[k + 1];
      var f = (v - a[0]) / (b[0] - a[0]);
      lut[i * 3] = U.lerp(a[1], b[1], f);
      lut[i * 3 + 1] = U.lerp(a[2], b[2], f);
      lut[i * 3 + 2] = U.lerp(a[3], b[3], f);
    }
    return lut;
  }

  var WP = Waterfall.prototype;
  WP.reset = function () {
    this.head = 0;
    this.count = 0;
    this.newestT = 0;
    this.octx.fillStyle = '#020806';
    this.octx.fillRect(0, 0, World.WF_BINS, ROWS);
  };
  WP.local = function (e) {
    var r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  WP.push = function (row) {
    var d = this.rowImg.data;
    var lut = this.lut;
    for (var i = 0; i < row.data.length; i++) {
      var v = Math.min(255, Math.max(0, Math.round(Math.sqrt(Math.max(0, row.data[i])) * 230)));
      d[i * 4] = lut[v * 3];
      d[i * 4 + 1] = lut[v * 3 + 1];
      d[i * 4 + 2] = lut[v * 3 + 2];
      d[i * 4 + 3] = 255;
    }
    this.head = (this.head - 1 + ROWS) % ROWS;
    this.octx.putImageData(this.rowImg, 0, this.head);
    this.count = Math.min(ROWS, this.count + 1);
    this.newestT = row.t;
  };
  WP.layout = function () {
    var x0 = 34,
      y0 = 20;
    return { x0: x0, y0: y0, pw: this.W - x0 - 6, ph: this.H - y0 - 4 };
  };
  WP.timeAt = function (y) {
    var L = this.layout();
    return this.newestT - ((y - L.y0) / L.ph) * ROWS * World.ROW_DT;
  };
  WP.onClick = function (m) {
    var app = this.app;
    var w = app.world;
    if (!w) return;
    var L = this.layout();
    if (m.y < L.y0 || m.x < L.x0) return;
    var t = this.timeAt(m.y);
    var b = ((m.x - L.x0) / L.pw) * 360;
    var tr = app.activeTrack();
    if (app.mode === 'split' && tr) {
      app.splitAt(tr, t);
      return;
    }
    // select the track whose sample is nearest the click
    var best = null,
      bd = 4;
    w.tracks.forEach(function (trk) {
      for (var i = trk.samples.length - 1; i >= 0; i--) {
        var s = trk.samples[i];
        if (s.t < t - 15) break;
        if (s.t > t + 15) continue;
        var d = Math.abs(U.wrap180(s.b - b));
        if (d < bd) {
          bd = d;
          best = trk;
        }
      }
    });
    if (best) app.setActive(best.id);
  };

  WP.draw = function () {
    fitCanvas(this);
    var ctx = this.ctx;
    var app = this.app;
    var w = app.world;
    var L = this.layout();
    ctx.fillStyle = '#020806';
    ctx.fillRect(0, 0, this.W, this.H);
    // ring buffer: newest row at the top
    var rowPx = L.ph / ROWS;
    var n1 = ROWS - this.head;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, this.head, World.WF_BINS, n1, L.x0, L.y0, L.pw, n1 * rowPx);
    if (this.head > 0) ctx.drawImage(this.off, 0, 0, World.WF_BINS, this.head, L.x0, L.y0 + n1 * rowPx, L.pw, this.head * rowPx);
    if (!w) return;

    var self = this;
    var xOf = function (b) {
      return L.x0 + (U.wrap360(b) / 360) * L.pw;
    };
    var yOf = function (t) {
      return L.y0 + ((self.newestT - t) / (ROWS * World.ROW_DT)) * L.ph;
    };
    var tOld = this.newestT - ROWS * World.ROW_DT;

    // header: bearing scale, baffles, own heading
    ctx.fillStyle = '#071014';
    ctx.fillRect(0, 0, this.W, L.y0);
    var astern = U.wrap360(w.own.hdg + 180);
    ctx.fillStyle = 'rgba(255,75,62,0.35)';
    for (var bb = -World.BAFFLE_HALF; bb < World.BAFFLE_HALF; bb += 1) {
      ctx.fillRect(xOf(astern + bb), L.y0 - 5, L.pw / 360 + 0.5, 5);
    }
    ctx.font = '10px ' + FD;
    ctx.fillStyle = COL.dim;
    ctx.strokeStyle = COL.faint;
    ctx.textAlign = 'center';
    var lblStep = L.pw > 420 ? 30 : 45;
    for (var d = 0; d <= 360; d += 10) {
      var x = L.x0 + (d / 360) * L.pw;
      ctx.beginPath();
      ctx.moveTo(x, L.y0 - (d % lblStep === 0 ? 7 : 3));
      ctx.lineTo(x, L.y0);
      ctx.stroke();
      if (d % lblStep === 0 && d < 360) ctx.fillText(U.fmtBrg(d), x, 10);
    }
    var hx = xOf(w.own.hdg);
    ctx.fillStyle = COL.own;
    ctx.beginPath();
    ctx.moveTo(hx, L.y0 - 1);
    ctx.lineTo(hx - 4, L.y0 - 8);
    ctx.lineTo(hx + 4, L.y0 - 8);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';

    // time axis
    ctx.fillStyle = '#071014';
    ctx.fillRect(0, L.y0, L.x0, L.ph);
    ctx.fillStyle = COL.dim;
    ctx.font = '10px ' + FD;
    for (var m = 2; m * 60 < ROWS * World.ROW_DT; m += 2) {
      var y = yOf(this.newestT - m * 60);
      ctx.fillRect(L.x0 - 4, y, 4, 1);
      ctx.fillText('-' + m + 'm', 3, y + 3);
    }

    // tracker marks
    var act = app.activeTrack();
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x0, L.y0, L.pw, L.ph);
    ctx.clip();
    w.tracks.forEach(function (tr) {
      var isAct = tr === act;
      ctx.fillStyle = tr.color;
      ctx.globalAlpha = isAct ? 0.95 : 0.55;
      var lastMark = -1e9;
      for (var i = tr.samples.length - 1; i >= 0; i--) {
        var s = tr.samples[i];
        if (s.t < tOld) break;
        if (lastMark - s.t < (isAct ? 12 : 30)) continue;
        lastMark = s.t;
        var mx = xOf(s.b),
          my = yOf(s.t);
        if (isAct) ctx.fillRect(mx - 3.5, my, 2, 1.6);
        else ctx.fillRect(mx - 3.5, my, 1.5, 1.2);
      }
    });
    ctx.globalAlpha = 1;
    // solution bearing curve for the selected track
    if (act && act.sol && World.solVel(act.sol) && act.samples.length) {
      var t0 = Math.max(act.samples[0].t, tOld);
      ctx.strokeStyle = 'rgba(232,251,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      var prevX = null;
      for (var t = w.t; t >= t0; t -= 12) {
        var op = w.ownAt(t);
        var pp = World.solPos(act.sol, t);
        var px = xOf(U.brg(op.x, op.y, pp.x, pp.y));
        var py = yOf(t);
        if (prevX === null || Math.abs(px - prevX) > L.pw / 2) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        prevX = px;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    // track labels along the top edge
    ctx.font = '11px ' + FD;
    w.tracks.forEach(function (tr) {
      var last = w.lastSample(tr);
      if (!last || tr.status === 'LOST' || tr.status === 'SUNK') return;
      var x = xOf(last.b);
      ctx.fillStyle = 'rgba(2,8,6,0.8)';
      var tw = ctx.measureText(tr.name).width + 6;
      ctx.fillRect(x - tw / 2, L.y0 + 2, tw, 13);
      ctx.fillStyle = tr.color;
      ctx.textAlign = 'center';
      ctx.fillText(tr.name, x, L.y0 + 12);
      ctx.textAlign = 'left';
      if (tr === act) {
        ctx.strokeStyle = tr.color;
        ctx.strokeRect(x - tw / 2 - 0.5, L.y0 + 1.5, tw + 1, 14);
      }
    });
    // cursor
    if (this.mouse && this.mouse.x > L.x0 && this.mouse.y > L.y0) {
      var cm = this.mouse;
      ctx.strokeStyle = app.mode === 'split' ? COL.alert : 'rgba(232,251,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.x0, cm.y + 0.5);
      ctx.lineTo(L.x0 + L.pw, cm.y + 0.5);
      if (app.mode !== 'split') {
        ctx.moveTo(cm.x + 0.5, L.y0);
        ctx.lineTo(cm.x + 0.5, L.y0 + L.ph);
      }
      ctx.stroke();
      var tb = ((cm.x - L.x0) / L.pw) * 360;
      var ago = (this.newestT - this.timeAt(cm.y)) / 60;
      var txt = (app.mode === 'split' ? 'SPLIT  ' : '') + U.fmtBrg(tb) + '  -' + ago.toFixed(1) + 'm';
      ctx.font = '11px ' + FD;
      var tw2 = ctx.measureText(txt).width + 8;
      var tx = Math.min(cm.x + 8, this.W - tw2 - 2);
      ctx.fillStyle = 'rgba(2,8,6,0.85)';
      ctx.fillRect(tx, cm.y - 18, tw2, 14);
      ctx.fillStyle = app.mode === 'split' ? COL.alert : COL.ruler;
      ctx.fillText(txt, tx + 4, cm.y - 7);
    }
  };

  // ---- dot stack -------------------------------------------------------------
  function DotStack(cv, app) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.app = app;
    this.mouse = null;
    var self = this;
    cv.addEventListener('pointermove', function (e) {
      var r = cv.getBoundingClientRect();
      self.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    cv.addEventListener('pointerleave', function () {
      self.mouse = null;
    });
    cv.addEventListener('pointerdown', function (e) {
      var r = cv.getBoundingClientRect();
      self.onClick({ x: e.clientX - r.left, y: e.clientY - r.top });
    });
  }
  var DP = DotStack.prototype;
  DP.layout = function (tr, w) {
    var x0 = 34,
      y0 = 8;
    var t1 = w.t;
    var t0 = tr && tr.samples.length ? tr.samples[0].t : t1 - 600;
    if (t1 - t0 < 120) t0 = t1 - 120;
    return { x0: x0, y0: y0, pw: this.W - x0 - 8, ph: this.H - y0 - 20, t0: t0, t1: t1 };
  };
  DP.onClick = function (m) {
    var app = this.app;
    var w = app.world;
    var tr = app.activeTrack();
    if (!w || !tr || app.mode !== 'split') return;
    var L = this.layout(tr, w);
    var t = L.t1 - ((m.y - L.y0) / L.ph) * (L.t1 - L.t0);
    app.splitAt(tr, t);
  };
  DP.draw = function () {
    fitCanvas(this);
    var ctx = this.ctx;
    var app = this.app;
    var w = app.world;
    ctx.fillStyle = '#040a0c';
    ctx.fillRect(0, 0, this.W, this.H);
    if (!w) return;
    var tr = app.activeTrack();
    var L = this.layout(tr, w);
    var S = app.dotScale;
    var cx = L.x0 + L.pw / 2;
    var xOf = function (e) {
      return cx + (e / S) * (L.pw / 2);
    };
    var yOf = function (t) {
      return L.y0 + ((L.t1 - t) / (L.t1 - L.t0)) * L.ph;
    };
    // grid
    ctx.lineWidth = 1;
    var gstep = S <= 2 ? 0.5 : S <= 5 ? 1 : 2;
    for (var g = -S; g <= S + 1e-6; g += gstep) {
      var gx = Math.round(xOf(g)) + 0.5;
      ctx.strokeStyle = Math.abs(g) < 1e-6 ? 'rgba(232,251,255,0.45)' : 'rgba(120,175,170,0.10)';
      ctx.beginPath();
      ctx.moveTo(gx, L.y0);
      ctx.lineTo(gx, L.y0 + L.ph);
      ctx.stroke();
    }
    ctx.font = '10px ' + FD;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'center';
    [-S, -S / 2, 0, S / 2, S].forEach(function (v) {
      ctx.fillText((v > 0 ? '+' : '') + v + '°', xOf(v), L.y0 + L.ph + 13);
    });
    ctx.textAlign = 'left';
    var span = L.t1 - L.t0;
    var mstep = span > 1800 ? 10 : span > 600 ? 5 : 2;
    for (var m = 0; m * 60 <= span; m += mstep) {
      var my = yOf(L.t1 - m * 60);
      ctx.fillStyle = 'rgba(120,175,170,0.25)';
      ctx.fillRect(L.x0 - 4, my, 4, 1);
      ctx.fillStyle = COL.dim;
      ctx.fillText('-' + m + 'm', 2, my + 3);
    }
    // own-ship turns as amber bars on the left edge: leg boundaries
    var h = w.ownHist;
    ctx.fillStyle = 'rgba(255,181,71,0.75)';
    for (var i = 1; i < h.length; i++) {
      if (h[i].t < L.t0) continue;
      if (Math.abs(U.wrap180(h[i].h - h[i - 1].h)) > 0.5) ctx.fillRect(L.x0 - 1, yOf(h[i].t) - 1, 4, 2);
    }
    if (!tr) {
      this.note('Select a track.');
      return;
    }
    var info = w.solInfo(tr);
    if (!info || !info.valid) {
      // no solution yet: show raw bearings so the trace can still be read
      var last = w.lastSample(tr);
      if (last) {
        ctx.fillStyle = tr.color;
        ctx.globalAlpha = 0.6;
        for (var k = 0; k < tr.samples.length; k++) {
          var s = tr.samples[k];
          var e = U.wrap180(s.b - last.b);
          if (Math.abs(e) > S) continue;
          ctx.fillRect(xOf(e) - 1, yOf(s.t) - 1, 2, 2);
        }
        ctx.globalAlpha = 1;
      }
      this.note(info ? 'Put the ruler ends on different lines.' : 'No solution. Bearings shown relative to the latest. Press R to lay the ruler.');
      return;
    }
    // ruler end times
    [
      ['A', tr.sol.ta],
      ['B', tr.sol.tb],
    ].forEach(function (p) {
      var y = yOf(p[1]);
      ctx.strokeStyle = 'rgba(232,251,255,0.3)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(L.x0, y);
      ctx.lineTo(L.x0 + L.pw, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COL.ruler;
      ctx.fillText(p[0], L.x0 + L.pw - 10, y - 3);
    });
    var res = info.res;
    var n = tr.samples.length;
    for (var j = 0; j < n; j++) {
      var sm = tr.samples[j];
      var ev = res[j];
      var y2 = yOf(sm.t);
      var age = (L.t1 - sm.t) / Math.max(1, L.t1 - L.t0);
      ctx.globalAlpha = 0.45 + 0.55 * (1 - age);
      if (Math.abs(ev) > S) {
        ctx.fillStyle = COL.alert;
        ctx.fillRect(ev > 0 ? L.x0 + L.pw - 3 : L.x0, y2 - 1, 3, 2);
      } else {
        var ae = Math.abs(ev);
        ctx.fillStyle = ae < 0.8 ? COL.phos : ae < 2 ? COL.warn : COL.alert;
        ctx.fillRect(xOf(ev) - 1.2, y2 - 1.2, 2.4, 2.4);
      }
    }
    ctx.globalAlpha = 1;
    if (this.mouse && app.mode === 'split') {
      ctx.strokeStyle = COL.alert;
      ctx.beginPath();
      ctx.moveTo(L.x0, this.mouse.y + 0.5);
      ctx.lineTo(L.x0 + L.pw, this.mouse.y + 0.5);
      ctx.stroke();
      var tt = L.t1 - ((this.mouse.y - L.y0) / L.ph) * (L.t1 - L.t0);
      ctx.fillStyle = COL.alert;
      ctx.fillText('SPLIT AT -' + ((w.t - tt) / 60).toFixed(1) + 'm', L.x0 + 6, this.mouse.y - 4);
    }
  };
  DP.note = function (msg) {
    var ctx = this.ctx;
    ctx.font = '13px ' + FL;
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'center';
    ctx.fillText(msg, this.W / 2 + 14, this.H / 2);
    ctx.textAlign = 'left';
  };

  // ---- heading dial -------------------------------------------------------------
  function Dial(cv, app) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.app = app;
    this.dragging = false;
    var self = this;
    function setFrom(e) {
      var r = cv.getBoundingClientRect();
      var x = e.clientX - r.left - r.width / 2;
      var y = e.clientY - r.top - r.height / 2;
      if (Math.hypot(x, y) < 8) return;
      var b = U.wrap360(Math.atan2(x, -y) * U.R2D);
      app.orderCourse(Math.round(b) % 360);
    }
    cv.addEventListener('pointerdown', function (e) {
      self.dragging = true;
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      setFrom(e);
    });
    cv.addEventListener('pointermove', function (e) {
      if (self.dragging) setFrom(e);
    });
    cv.addEventListener('pointerup', function () {
      self.dragging = false;
    });
  }
  Dial.prototype.draw = function () {
    fitCanvas(this);
    var ctx = this.ctx;
    var w = this.app.world;
    var W = this.W,
      H = this.H;
    var cx = W / 2,
      cy = H / 2;
    var R = Math.min(W, H) / 2 - 4;
    ctx.clearRect(0, 0, W, H);
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, '#0d1c22');
    g.addColorStop(1, '#060d10');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a424a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (!w) return;
    var o = w.own;
    function pt(b, r) {
      return { x: cx + Math.sin(b * U.D2R) * r, y: cy - Math.cos(b * U.D2R) * r };
    }
    // baffles
    ctx.fillStyle = 'rgba(255,75,62,0.16)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R - 1, (o.hdg + 180 - World.BAFFLE_HALF - 90) * U.D2R, (o.hdg + 180 + World.BAFFLE_HALF - 90) * U.D2R);
    ctx.closePath();
    ctx.fill();
    // ticks
    ctx.strokeStyle = COL.dim;
    for (var d = 0; d < 360; d += 5) {
      var p1 = pt(d, R - 2);
      var p2 = pt(d, R - (d % 30 === 0 ? 10 : d % 10 === 0 ? 6 : 3));
      ctx.lineWidth = d % 30 === 0 ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.font = '10px ' + FD;
    ctx.fillStyle = COL.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var l = 0; l < 360; l += 30) {
      var lp = pt(l, R - 19);
      ctx.fillText(l === 0 ? 'N' : l === 90 ? 'E' : l === 180 ? 'S' : l === 270 ? 'W' : String(l / 10), lp.x, lp.y);
    }
    // contact bearing pips
    var act = this.app.activeTrack();
    w.tracks.forEach(function (tr) {
      var last = w.lastSample(tr);
      if (!last || tr.status === 'LOST' || tr.status === 'SUNK') return;
      var a = pt(last.b, R + 1),
        b = pt(last.b, R - 9);
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = tr === act ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    // ordered course
    var oc = pt(o.ordHdg, R - 2);
    var ol = pt(o.ordHdg - 5, R - 13);
    var orr = pt(o.ordHdg + 5, R - 13);
    ctx.fillStyle = COL.amber;
    ctx.beginPath();
    ctx.moveTo(oc.x, oc.y);
    ctx.lineTo(ol.x, ol.y);
    ctx.lineTo(orr.x, orr.y);
    ctx.closePath();
    ctx.fill();
    // heading needle
    var tip = pt(o.hdg, R - 24);
    var tail = pt(o.hdg + 180, 18);
    ctx.strokeStyle = COL.own;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = COL.own;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#060d10';
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a424a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COL.ink;
    ctx.font = '12px ' + FD;
    ctx.fillText(U.fmtBrg(o.hdg), cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  };

  TMA.Waterfall = Waterfall;
  TMA.DotStack = DotStack;
  TMA.Dial = Dial;
})();
