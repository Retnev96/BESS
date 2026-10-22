/* Geographic plot: bearing lines, own-ship track, the TMA ruler and weapons. */
'use strict';
(function () {
  var U = TMA.U;
  var World = TMA.World;

  var COL = (TMA.COL = {
    bg0: '#08141a',
    bg1: '#050b0e',
    grid: 'rgba(120,175,170,0.06)',
    grid2: 'rgba(120,175,170,0.12)',
    ring: 'rgba(90,169,255,0.20)',
    ink: '#c3dbd6',
    dim: '#6c8a86',
    faint: '#3b5452',
    own: '#5aa9ff',
    ruler: '#e8fbff',
    amber: '#ffb547',
    alert: '#ff4b3e',
    good: '#5cf29a',
    warn: '#ffcf4a',
    phos: '#5cf29a',
  });
  var FONT_DATA = '"Share Tech Mono", ui-monospace, Menlo, monospace';
  var FONT_LABEL = '"Barlow Condensed", "Arial Narrow", sans-serif';
  TMA.FONT_DATA = FONT_DATA;
  TMA.FONT_LABEL = FONT_LABEL;
  var FAR = 150000;

  function GeoPlot(cv, app) {
    this.cv = cv;
    this.ctx = cv.getContext('2d');
    this.app = app;
    this.view = { cx: 0, cy: 0, scale: 0.022 };
    this.mouse = null;
    this.drag = null;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    var self = this;
    cv.addEventListener('pointerdown', function (e) {
      self.onDown(e);
    });
    cv.addEventListener('pointermove', function (e) {
      self.onMove(e);
    });
    cv.addEventListener('pointerup', function (e) {
      self.onUp(e);
    });
    cv.addEventListener('pointercancel', function (e) {
      self.onUp(e);
    });
    cv.addEventListener('pointerleave', function () {
      if (!self.drag) self.mouse = null;
    });
    cv.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault();
        self.zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, self.local(e));
      },
      { passive: false }
    );
    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
    cv.addEventListener('dblclick', function (e) {
      var m = self.local(e);
      var p = self.s2w(m.x, m.y);
      self.view.cx = p.x;
      self.view.cy = p.y;
      self.app.setFollow(false);
    });
  }
  var P = GeoPlot.prototype;

  P.local = function (e) {
    var r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  P.w2s = function (x, y) {
    return { x: this.W / 2 + (x - this.view.cx) * this.view.scale, y: this.H / 2 - (y - this.view.cy) * this.view.scale };
  };
  P.s2w = function (sx, sy) {
    return { x: this.view.cx + (sx - this.W / 2) / this.view.scale, y: this.view.cy - (sy - this.H / 2) / this.view.scale };
  };

  P.resize = function () {
    var r = this.cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(10, Math.round(r.width));
    var h = Math.max(10, Math.round(r.height));
    if (w !== this.W || h !== this.H || dpr !== this.dpr) {
      this.W = w;
      this.H = h;
      this.dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
    }
  };

  P.zoom = function (f, at) {
    var v = this.view;
    var ns = U.clamp(v.scale * f, 0.0025, 0.6);
    if (!at || this.app.follow) {
      v.scale = ns;
      return;
    }
    var p = this.s2w(at.x, at.y);
    v.scale = ns;
    // keep the point under the cursor fixed
    v.cx = p.x - (at.x - this.W / 2) / ns;
    v.cy = p.y + (at.y - this.H / 2) / ns;
  };

  // Bearing lines a ruler end can snap to: the decimated lines plus the newest bearing.
  P.candidates = function (tr) {
    var w = this.app.world;
    var lines = w.lines(tr, this.app.lineIv).slice();
    var last = w.lastSample(tr);
    if (last && (!lines.length || last.t - lines[lines.length - 1].t > 4)) {
      var n = tr.samples.length;
      var bs = [];
      for (var k = Math.max(0, n - 5); k < n; k++) bs.push(tr.samples[k].b);
      lines.push({ t: last.t, ox: last.ox, oy: last.oy, b: U.circMean(bs), cur: true });
    }
    return lines;
  };

  // Nearest bearing line to a screen point, with the snapped world point.
  P.nearestLine = function (lines, m) {
    var best = null;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      var o = this.w2s(L.ox, L.oy);
      var dx = Math.sin(L.b * U.D2R);
      var dy = -Math.cos(L.b * U.D2R);
      var rx = m.x - o.x;
      var ry = m.y - o.y;
      var s = rx * dx + ry * dy;
      if (s < 0) continue;
      var perp = Math.abs(rx * dy - ry * dx);
      if (!best || perp < best.perp) {
        var sy = s / this.view.scale;
        best = { L: L, perp: perp, x: L.ox + Math.sin(L.b * U.D2R) * sy, y: L.oy + Math.cos(L.b * U.D2R) * sy };
      }
    }
    return best;
  };

  P.pickTrack = function (m) {
    var w = this.app.world;
    var best = null;
    var bd = 9;
    for (var i = 0; i < w.tracks.length; i++) {
      var tr = w.tracks[i];
      var n = this.nearestLine(this.candidates(tr), m);
      if (n && n.perp < bd) {
        bd = n.perp;
        best = tr;
      }
    }
    return best;
  };

  function segDist(p, a, b) {
    var dx = b.x - a.x,
      dy = b.y - a.y;
    var L = dx * dx + dy * dy;
    var f = L > 0 ? U.clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
    return Math.hypot(p.x - a.x - dx * f, p.y - a.y - dy * f);
  }

  P.onDown = function (e) {
    var app = this.app;
    if (!app.world) return;
    var m = this.local(e);
    this.mouse = m;
    try {
      this.cv.setPointerCapture(e.pointerId);
    } catch (err) {
      /* not all pointers can be captured */
    }
    if (e.button === 1 || e.button === 2) {
      this.drag = { type: 'pan', x: m.x, y: m.y };
      return;
    }
    var tr = app.activeTrack();
    if (tr && tr.sol) {
      var A = this.w2s(tr.sol.ax, tr.sol.ay);
      var B = this.w2s(tr.sol.bx, tr.sol.by);
      if (Math.hypot(m.x - A.x, m.y - A.y) < 11) this.drag = { type: 'A' };
      else if (Math.hypot(m.x - B.x, m.y - B.y) < 11) this.drag = { type: 'B' };
      else if (segDist(m, A, B) < 7) this.drag = { type: 'move', start: m, sol0: Object.assign({}, tr.sol) };
      if (this.drag) return;
    }
    if (app.mode === 'ruler') {
      if (!tr) {
        app.toast('Select a track first.', 'warn');
        return;
      }
      var n = this.nearestLine(this.candidates(tr), m);
      if (!n) {
        app.toast('No bearings on ' + tr.name + ' yet.', 'warn');
        return;
      }
      app.world.setSol(tr, { ta: n.L.t, ax: n.x, ay: n.y, tb: n.L.t, bx: n.x, by: n.y });
      this.drag = { type: 'create', start: m };
      return;
    }
    if (app.mode === 'split') {
      if (!tr) return;
      var ns = this.nearestLine(app.world.lines(tr, app.lineIv), m);
      if (ns && ns.perp < 16) app.splitAt(tr, ns.L.t);
      return;
    }
    var pick = this.pickTrack(m);
    if (pick) {
      app.setActive(pick.id);
      return;
    }
    this.drag = { type: 'pan', x: m.x, y: m.y };
  };

  P.onMove = function (e) {
    var m = this.local(e);
    this.mouse = m;
    var d = this.drag;
    if (!d) return;
    var app = this.app;
    var w = app.world;
    if (d.type === 'pan') {
      this.view.cx -= (m.x - d.x) / this.view.scale;
      this.view.cy += (m.y - d.y) / this.view.scale;
      d.x = m.x;
      d.y = m.y;
      app.setFollow(false);
      return;
    }
    var tr = app.activeTrack();
    if (!tr || !tr.sol) {
      this.drag = null;
      return;
    }
    var sol = Object.assign({}, tr.sol);
    if (d.type === 'move') {
      var dx = (m.x - d.start.x) / this.view.scale;
      var dy = -(m.y - d.start.y) / this.view.scale;
      sol.ax = d.sol0.ax + dx;
      sol.ay = d.sol0.ay + dy;
      sol.bx = d.sol0.bx + dx;
      sol.by = d.sol0.by + dy;
    } else {
      var k = d.type === 'A' ? 'a' : 'b';
      if (e.shiftKey) {
        var p = this.s2w(m.x, m.y);
        sol[k + 'x'] = p.x;
        sol[k + 'y'] = p.y;
      } else {
        var n = this.nearestLine(this.candidates(tr), m);
        if (!n) return;
        sol['t' + k] = n.L.t;
        sol[k + 'x'] = n.x;
        sol[k + 'y'] = n.y;
      }
    }
    w.setSol(tr, sol);
  };

  P.onUp = function (e) {
    var d = this.drag;
    this.drag = null;
    try {
      this.cv.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    if (!d) return;
    var tr = this.app.activeTrack();
    if ((d.type === 'create' || d.type === 'A' || d.type === 'B') && tr && tr.sol && Math.abs(tr.sol.tb - tr.sol.ta) < 1) {
      if (d.type === 'create') tr.sol = null;
      this.app.toast('Put the two ends of the ruler on different bearing lines.', 'warn');
    } else if (d.type === 'create' && tr && tr.sol) {
      TMA.Audio.play('click');
    }
  };

  // ---- drawing -----------------------------------------------------------
  P.draw = function () {
    this.resize();
    var app = this.app;
    var w = app.world;
    var ctx = this.ctx;
    var W = this.W,
      H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, COL.bg0);
    g.addColorStop(1, COL.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (!w) return;

    var o = w.own;
    if (app.follow) {
      this.view.cx = o.x;
      this.view.cy = o.y;
    }
    this.drawGrid(ctx);
    this.drawRings(ctx, o);
    if (app.showTruth || w.over) this.drawTruth(ctx, w);

    var act = app.activeTrack();
    var self = this;
    // other tracks first, dim
    w.tracks.forEach(function (tr) {
      if (tr !== act) self.drawTrackLines(ctx, w, tr, false);
    });
    if (act) this.drawTrackLines(ctx, w, act, true);

    this.drawOwnTrack(ctx, w);
    w.tracks.forEach(function (tr) {
      if (tr !== act && tr.sol) self.drawSolMarker(ctx, w, tr, false);
    });
    if (act) {
      this.drawHover(ctx, w, act);
      if (act.sol) this.drawRuler(ctx, w, act);
      this.drawLead(ctx, w, act);
    }
    this.drawWeapons(ctx, w);
    this.drawHud(ctx, w, act);
  };

  P.drawGrid = function (ctx) {
    var s = this.view.scale;
    var steps = [500, 1000, 2000, 5000, 10000, 20000, 50000];
    var step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] * s >= 45) {
        step = steps[i];
        break;
      }
    }
    var tl = this.s2w(0, 0);
    var br = this.s2w(this.W, this.H);
    ctx.lineWidth = 1;
    for (var x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      var sx = Math.round(this.w2s(x, 0).x) + 0.5;
      ctx.strokeStyle = Math.round(x / step) % 5 === 0 ? COL.grid2 : COL.grid;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.H);
      ctx.stroke();
    }
    for (var y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
      var sy = Math.round(this.w2s(0, y).y) + 0.5;
      ctx.strokeStyle = Math.round(y / step) % 5 === 0 ? COL.grid2 : COL.grid;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(this.W, sy);
      ctx.stroke();
    }
    this.gridStep = step;
  };

  P.drawRings = function (ctx, o) {
    var s = this.view.scale;
    var steps = [1000, 2000, 5000, 10000, 20000];
    var step = 20000;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] * s >= 70) {
        step = steps[i];
        break;
      }
    }
    var c = this.w2s(o.x, o.y);
    var maxR = Math.hypot(this.W, this.H);
    ctx.strokeStyle = COL.ring;
    ctx.fillStyle = 'rgba(90,169,255,0.55)';
    ctx.font = '11px ' + FONT_DATA;
    ctx.setLineDash([2, 5]);
    for (var r = step; r * s < maxR; r += step) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(r / 1000 + 'k', c.x + r * s * 0.707 + 3, c.y - r * s * 0.707 - 3);
    }
    ctx.setLineDash([]);
  };

  function ray(ctx, p, b, len) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.sin(b * U.D2R) * len, p.y - Math.cos(b * U.D2R) * len);
  }

  P.drawTrackLines = function (ctx, w, tr, active) {
    var app = this.app;
    var lines = w.lines(tr, app.lineIv);
    var n = lines.length;
    var len = FAR * this.view.scale;
    ctx.strokeStyle = tr.color;
    if (active) {
      for (var i = 0; i < n; i++) {
        var L = lines[i];
        var p = this.w2s(L.ox, L.oy);
        ctx.globalAlpha = 0.28 + 0.6 * (n > 1 ? i / (n - 1) : 1);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ray(ctx, p, L.b, len);
        ctx.stroke();
      }
    } else if (app.showAll && tr.status !== 'SUNK') {
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var j = 0; j < n; j++) {
        ray(ctx, this.w2s(lines[j].ox, lines[j].oy), lines[j].b, len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // current bearing from own ship's present position
    var last = w.lastSample(tr);
    if (last && tr.status !== 'LOST' && tr.status !== 'SUNK') {
      var op = this.w2s(w.own.x, w.own.y);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = active ? 1.6 : 1;
      ctx.globalAlpha = active ? 0.95 : 0.55;
      ctx.beginPath();
      ray(ctx, op, last.b, len);
      ctx.stroke();
      ctx.setLineDash([]);
      // label the ray just inside the plot edge
      var dist = Math.min(this.W, this.H) * 0.46;
      var lx = op.x + Math.sin(last.b * U.D2R) * dist;
      var ly = op.y - Math.cos(last.b * U.D2R) * dist;
      ctx.font = (active ? 'bold 14px ' : '12px ') + FONT_DATA;
      ctx.fillStyle = tr.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(5,11,14,0.75)';
      var lbl = tr.name + ' ' + U.fmtBrg(last.b);
      var tw = ctx.measureText(lbl).width + 8;
      ctx.fillRect(lx - tw / 2, ly - 9, tw, 18);
      ctx.fillStyle = tr.color;
      ctx.fillText(lbl, lx, ly);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.globalAlpha = 1;
  };

  P.drawOwnTrack = function (ctx, w) {
    var h = w.ownHist;
    ctx.strokeStyle = 'rgba(90,169,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i < h.length; i++) {
      var p = this.w2s(h[i].x, h[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    var cp = this.w2s(w.own.x, w.own.y);
    ctx.lineTo(cp.x, cp.y);
    ctx.stroke();
    ctx.fillStyle = COL.own;
    for (var j = 0; j < h.length; j += 30) {
      var q = this.w2s(h[j].x, h[j].y);
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    // own ship symbol
    var o = w.own;
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate(o.hdg * U.D2R);
    ctx.shadowColor = COL.own;
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#0b2440';
    ctx.strokeStyle = COL.own;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.quadraticCurveTo(5.5, -8, 5.5, 2);
    ctx.lineTo(4, 10);
    ctx.lineTo(-4, 10);
    ctx.lineTo(-5.5, 2);
    ctx.quadraticCurveTo(-5.5, -8, 0, -13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COL.own;
    ctx.fillRect(-1.5, -5, 3, 5); // sail
    // heading leader: three minutes of travel, at least 30 px
    var lead = Math.max(30, o.spd * TMA.U.KT * 180 * this.view.scale);
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(0, -13 - lead);
    ctx.stroke();
    ctx.restore();
    // ordered course marker
    if (Math.abs(U.wrap180(o.ordHdg - o.hdg)) > 1) {
      ctx.strokeStyle = COL.amber;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ray(ctx, cp, o.ordHdg, 70);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  P.drawSolMarker = function (ctx, w, tr, active) {
    var v = World.solVel(tr.sol);
    if (!v) return;
    var p = World.solPos(tr.sol, w.t);
    var s = this.w2s(p.x, p.y);
    var crs = Math.atan2(v.vx, v.vy);
    var lead = Math.max(18, Math.hypot(v.vx, v.vy) * 360 * this.view.scale);
    ctx.strokeStyle = active ? COL.ruler : tr.color;
    ctx.fillStyle = 'rgba(5,11,14,0.8)';
    ctx.lineWidth = active ? 2 : 1.4;
    // unknown-contact symbol: a half diamond above the waterline
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y);
    ctx.lineTo(s.x, s.y - 8);
    ctx.lineTo(s.x + 8, s.y);
    ctx.lineTo(s.x, s.y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.sin(crs) * lead, s.y - Math.cos(crs) * lead);
    ctx.stroke();
    ctx.font = '12px ' + FONT_DATA;
    ctx.fillStyle = active ? COL.ruler : tr.color;
    ctx.fillText(tr.name, s.x + 10, s.y + 14);
  };

  P.drawHover = function (ctx, w, tr) {
    var app = this.app;
    if (!this.mouse || this.drag || (app.mode !== 'ruler' && app.mode !== 'split')) return;
    var lines = app.mode === 'ruler' ? this.candidates(tr) : w.lines(tr, app.lineIv);
    var n = this.nearestLine(lines, this.mouse);
    if (!n) return;
    var p = this.w2s(n.L.ox, n.L.oy);
    ctx.strokeStyle = app.mode === 'split' ? COL.alert : COL.ruler;
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ray(ctx, p, n.L.b, FAR * this.view.scale);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (app.mode === 'ruler') {
      var q = this.w2s(n.x, n.y);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = '12px ' + FONT_DATA;
    ctx.fillStyle = app.mode === 'split' ? COL.alert : COL.ruler;
    var ago = Math.max(0, (w.t - n.L.t) / 60);
    ctx.fillText((app.mode === 'split' ? 'SPLIT AT ' : '') + U.fmtClock(n.L.t) + '  (' + ago.toFixed(1) + ' min ago)', this.mouse.x + 14, this.mouse.y - 10);
  };

  P.drawRuler = function (ctx, w, tr) {
    var sol = tr.sol;
    var A = this.w2s(sol.ax, sol.ay);
    var B = this.w2s(sol.bx, sol.by);
    var v = World.solVel(sol);
    var app = this.app;
    if (v) {
      var tLast = sol.ta > sol.tb ? sol.ta : sol.tb;
      var Lp = sol.ta > sol.tb ? A : B;
      var now = World.solPos(sol, w.t);
      var N = this.w2s(now.x, now.y);
      // extension from the later end to where the solution says the target is now
      ctx.strokeStyle = 'rgba(232,251,255,0.55)';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(Lp.x, Lp.y);
      ctx.lineTo(N.x, N.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // ticks and residual whiskers, one per bearing line
      var lines = w.lines(tr, app.lineIv);
      var ux = (B.x - A.x),
        uy = (B.y - A.y);
      var ul = Math.hypot(ux, uy) || 1;
      var nx = -uy / ul,
        ny = ux / ul;
      if (sol.tb < sol.ta) {
        nx = -nx;
        ny = -ny;
      }
      for (var i = 0; i < lines.length; i++) {
        var L = lines[i];
        var pw = World.solPos(sol, L.t);
        var ps = this.w2s(pw.x, pw.y);
        var err = U.wrap180(L.b - U.brg(L.ox, L.oy, pw.x, pw.y));
        var ae = Math.abs(err);
        var col = ae < 0.6 ? COL.good : ae < 1.6 ? COL.warn : COL.alert;
        // foot of the perpendicular on the bearing line
        var dx = Math.sin(L.b * U.D2R),
          dy = Math.cos(L.b * U.D2R);
        var s = Math.max(0, (pw.x - L.ox) * dx + (pw.y - L.oy) * dy);
        var fs = this.w2s(L.ox + dx * s, L.oy + dy * s);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ps.x, ps.y);
        ctx.lineTo(fs.x, fs.y);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ps.x - nx * 5, ps.y - ny * 5);
        ctx.lineTo(ps.x + nx * 5, ps.y + ny * 5);
        ctx.stroke();
      }
      if (tLast < w.t) this.drawSolMarker(ctx, w, tr, true);
    }
    // the ruler itself
    ctx.save();
    ctx.shadowColor = 'rgba(232,251,255,0.8)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = COL.ruler;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
    ctx.restore();
    var self = this;
    [
      ['A', A, sol.ta],
      ['B', B, sol.tb],
    ].forEach(function (h) {
      var hot = self.mouse && Math.hypot(self.mouse.x - h[1].x, self.mouse.y - h[1].y) < 11;
      ctx.fillStyle = hot ? COL.ruler : '#0a1a20';
      ctx.strokeStyle = COL.ruler;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h[1].x, h[1].y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '11px ' + FONT_DATA;
      ctx.fillStyle = COL.ruler;
      ctx.fillText(h[0] + ' -' + ((w.t - h[2]) / 60).toFixed(1) + 'm', h[1].x + 10, h[1].y - 8);
    });
    if (v) {
      var info = w.solInfo(tr);
      var txt = 'C ' + U.fmtBrg(info.crs) + '  S ' + info.spd.toFixed(1) + '  R ' + U.fmtKyd(info.rng);
      var mx = (A.x + B.x) / 2,
        my = (A.y + B.y) / 2;
      ctx.font = '13px ' + FONT_DATA;
      var tw = ctx.measureText(txt).width + 10;
      // keep the readout on screen
      var bx = U.clamp(mx + 12, 4, this.W - tw - 4);
      var by = U.clamp(my + 8, 40, this.H - 44);
      ctx.fillStyle = 'rgba(5,11,14,0.82)';
      ctx.fillRect(bx, by, tw, 20);
      ctx.strokeStyle = 'rgba(232,251,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 19);
      ctx.fillStyle = COL.ruler;
      ctx.fillText(txt, bx + 5, by + 14);
    }
  };

  // Weapon lead line: where a torpedo fired now would go.
  P.drawLead = function (ctx, w, tr) {
    var pre = w.presets(tr, this.app.enableOffset);
    if (!pre || pre.mode !== 'SOLUTION') return;
    var o = this.w2s(w.own.x, w.own.y);
    var i = this.w2s(pre.ix, pre.iy);
    ctx.strokeStyle = 'rgba(255,75,62,0.45)';
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(i.x, i.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(i.x - 5, i.y - 5);
    ctx.lineTo(i.x + 5, i.y + 5);
    ctx.moveTo(i.x + 5, i.y - 5);
    ctx.lineTo(i.x - 5, i.y + 5);
    ctx.stroke();
  };

  P.drawWeapons = function (ctx, w) {
    var s = this.view.scale;
    for (var i = 0; i < w.torps.length; i++) {
      var t = w.torps[i];
      var live = t.state !== 'DONE';
      ctx.strokeStyle = live ? 'rgba(255,75,62,0.75)' : 'rgba(255,75,62,0.3)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (var k = 0; k < t.trail.length; k++) {
        var q = this.w2s(t.trail[k].x, t.trail[k].y);
        if (k === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      var p = this.w2s(t.x, t.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!live) continue;
      if (t.state === 'RTE') {
        var togo = t.enable - t.run;
        var e = this.w2s(t.x + Math.sin(t.gyro * U.D2R) * togo, t.y + Math.cos(t.gyro * U.D2R) * togo);
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // seeker cone
        var R = 2800 * s;
        var a0 = (t.hdg - World.TORP.seekerHalf - 90) * U.D2R;
        var a1 = (t.hdg + World.TORP.seekerHalf - 90) * U.D2R;
        ctx.fillStyle = t.state === 'HOMING' ? 'rgba(255,75,62,0.20)' : 'rgba(255,75,62,0.10)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, R, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(t.hdg * U.D2R);
      ctx.fillStyle = COL.alert;
      ctx.shadowColor = COL.alert;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = '12px ' + FONT_DATA;
      ctx.fillStyle = COL.alert;
      ctx.fillText(t.name + ' ' + t.state, p.x + 9, p.y - 7);
    }
    // detonation flashes
    for (var b = 0; b < w.blasts.length; b++) {
      var bl = w.blasts[b];
      var age = w.t - bl.t;
      if (age < 0 || age > 90) continue;
      var c = this.w2s(bl.x, bl.y);
      var r = 6 + age * 1.6;
      ctx.strokeStyle = 'rgba(255,181,71,' + (1 - age / 90).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  P.drawTruth = function (ctx, w) {
    ctx.font = '11px ' + FONT_LABEL;
    for (var i = 0; i < w.contacts.length; i++) {
      var c = w.contacts[i];
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([1, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = 0; k < c.trail.length; k++) {
        var q = this.w2s(c.trail[k].x, c.trail[k].y);
        if (k === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      var p = this.w2s(c.x, c.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = c.alive ? 'rgba(255,255,255,0.85)' : 'rgba(255,75,62,0.8)';
      ctx.lineWidth = 1.4;
      if (c.alive) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        var lead = c.spd * U.KT * 360 * this.view.scale;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.sin(c.crs * U.D2R) * lead, p.y - Math.cos(c.crs * U.D2R) * lead);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(p.x - 6, p.y - 6);
        ctx.lineTo(p.x + 6, p.y + 6);
        ctx.moveTo(p.x + 6, p.y - 6);
        ctx.lineTo(p.x - 6, p.y + 6);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('TRUTH ' + c.type.name + ' ' + U.fmtBrg(c.crs) + '/' + c.spd.toFixed(1) + 'KT', p.x + 9, p.y + 16);
    }
  };

  P.drawHud = function (ctx, w, act) {
    var W = this.W,
      H = this.H;
    var app = this.app;
    // north arrow
    ctx.strokeStyle = COL.dim;
    ctx.fillStyle = COL.dim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(26, 46);
    ctx.lineTo(26, 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(26, 12);
    ctx.lineTo(21, 22);
    ctx.lineTo(31, 22);
    ctx.closePath();
    ctx.fill();
    ctx.font = '12px ' + FONT_LABEL;
    ctx.fillText('N', 22, 60);
    // scale bar
    var step = this.gridStep || 5000;
    var len = step * this.view.scale;
    ctx.strokeStyle = COL.ink;
    ctx.beginPath();
    ctx.moveTo(16, H - 18);
    ctx.lineTo(16 + len, H - 18);
    ctx.moveTo(16, H - 23);
    ctx.lineTo(16, H - 13);
    ctx.moveTo(16 + len, H - 23);
    ctx.lineTo(16 + len, H - 13);
    ctx.stroke();
    ctx.fillStyle = COL.ink;
    ctx.font = '11px ' + FONT_DATA;
    ctx.fillText(step >= 1000 ? step / 1000 + ' KYD' : step + ' YD', 22 + len, H - 14);
    // cursor readout relative to own ship
    if (this.mouse) {
      var p = this.s2w(this.mouse.x, this.mouse.y);
      var b = U.brg(w.own.x, w.own.y, p.x, p.y);
      var r = U.dist(w.own.x, w.own.y, p.x, p.y);
      var txt = 'CURSOR  BRG ' + U.fmtBrg(b) + '  RNG ' + U.fmtKyd(r) + ' KYD';
      ctx.font = '12px ' + FONT_DATA;
      var tw = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(5,11,14,0.7)';
      ctx.fillRect(W - tw - 22, H - 30, tw + 12, 20);
      ctx.fillStyle = COL.ink;
      ctx.fillText(txt, W - tw - 16, H - 16);
    }
    // mode banner
    var banner = null;
    if (app.mode === 'ruler') banner = act ? 'RULER  ' + act.name + '  /  drag from an old bearing line to a recent one, Shift for free placement' : 'RULER  /  select a track first';
    else if (app.mode === 'split') banner = act ? 'SPLIT  ' + act.name + '  /  click the bearing line where the new track should start' : 'SPLIT  /  select a track first';
    if (app.paused) banner = 'PAUSED  /  press Space to resume' + (banner ? '      ' + banner : '');
    if (banner) {
      ctx.font = '13px ' + FONT_LABEL;
      var bw = ctx.measureText(banner).width + 24;
      if (bw > W - 20) {
        banner = banner.split('  /  ')[0];
        bw = ctx.measureText(banner).width + 24;
      }
      ctx.fillStyle = 'rgba(5,11,14,0.85)';
      ctx.fillRect(W / 2 - bw / 2, 10, bw, 24);
      ctx.strokeStyle = app.mode === 'split' ? COL.alert : app.paused ? COL.amber : COL.ruler;
      ctx.strokeRect(W / 2 - bw / 2 + 0.5, 10.5, bw - 1, 23);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'center';
      ctx.fillText(banner, W / 2, 27);
      ctx.textAlign = 'left';
    }
    if (app.showTruth && !w.over) {
      ctx.font = '12px ' + FONT_LABEL;
      ctx.fillStyle = COL.warn;
      ctx.fillText('TRUTH DISPLAYED  /  shots fired now are flagged in the debrief', 16, H - 34);
    }
  };

  TMA.GeoPlot = GeoPlot;
})();
