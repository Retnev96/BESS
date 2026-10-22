/* App controller and the frame loop. */
'use strict';
(function () {
  var U = TMA.U;
  var World = TMA.World;
  var UI = TMA.UI;
  var Audio = TMA.Audio;

  var app = (TMA.app = {
    world: null,
    running: false,
    paused: false,
    tc: 8,
    acc: 0,
    mode: 'select',
    lineIv: 60,
    showAll: true,
    follow: true,
    showTruth: false,
    dotScale: 5,
    enableOffset: 2500,
    activeId: null,
    chosen: new Set(),
    listen: false,
    setup: { difficulty: 'normal', contacts: 3 },
  });

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem('tma-prefs') || '{}');
      if (p.difficulty) app.setup.difficulty = p.difficulty;
      if (p.contacts) app.setup.contacts = p.contacts;
      if (p.sound === false) Audio.state.sound = false;
      if (p.voice === false) Audio.state.voice = false;
    } catch (e) {
      /* storage is optional */
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(
        'tma-prefs',
        JSON.stringify({ difficulty: app.setup.difficulty, contacts: app.setup.contacts, sound: Audio.state.sound, voice: Audio.state.voice })
      );
    } catch (e) {
      /* storage is optional */
    }
  }

  app.activeTrack = function () {
    return app.world && app.activeId !== null ? app.world.trackById(app.activeId) : null;
  };
  app.setActive = function (id) {
    if (app.activeId !== id) Audio.play('click');
    app.activeId = id;
    UI.update();
  };
  app.cycleTrack = function (dir) {
    var trs = app.world.tracks.filter(function (t) {
      return t.status !== 'SUNK';
    });
    if (!trs.length) return;
    var i = trs.indexOf(app.activeTrack());
    app.setActive(trs[(i + dir + trs.length) % trs.length].id);
  };
  app.toggleChosen = function (id) {
    if (app.chosen.has(id)) app.chosen.delete(id);
    else app.chosen.add(id);
    Audio.play('click');
  };
  app.setMode = function (m) {
    app.mode = m;
    Audio.play('click');
    UI.update();
  };
  app.setFollow = function (on) {
    app.follow = on;
    UI.update();
  };
  app.togglePause = function () {
    app.paused = !app.paused;
    UI.update();
  };
  app.setTc = function (tc) {
    app.tc = tc;
    app.paused = false;
    Audio.play('click');
    UI.update();
  };
  app.setSound = function (on) {
    Audio.setSound(on);
    UI.syncToggles();
    savePrefs();
  };
  app.setVoice = function (on) {
    Audio.setVoice(on);
    UI.syncToggles();
    savePrefs();
  };
  app.toggleTruth = function () {
    app.showTruth = !app.showTruth;
    if (app.showTruth && app.world) app.world.truthShown = true;
    UI.update();
  };
  app.toggleListen = function () {
    app.listen = !app.listen;
    UI.update();
  };
  app.toast = function (msg, kind) {
    UI.toast(msg.replace(/</g, '&lt;'), kind === 'warn' ? '' : kind);
  };

  // Helm orders go in the log once the operator stops adjusting them.
  var orderTimer = null;
  function logOrders() {
    clearTimeout(orderTimer);
    orderTimer = setTimeout(function () {
      var w = app.world;
      if (!w) return;
      var o = w.own;
      var txt = [];
      if (o.ordHdg !== app.loggedHdg) {
        var d = U.wrap180(o.ordHdg - o.hdg);
        txt.push(Math.abs(d) < 1 ? 'Steady on course ' + U.fmtBrg(o.ordHdg) + '.' : 'Come ' + (d > 0 ? 'right' : 'left') + ' to course ' + U.fmtBrg(o.ordHdg) + '.');
      }
      if (o.ordSpd !== app.loggedSpd) txt.push(o.ordSpd === 0 ? 'All stop.' : 'Make turns for ' + o.ordSpd + ' knots.');
      app.loggedHdg = o.ordHdg;
      app.loggedSpd = o.ordSpd;
      if (txt.length) w.emit({ src: 'CONN', text: txt.join(' ') });
    }, 700);
  }

  app.orderCourse = function (c) {
    if (!app.world) return;
    app.world.own.ordHdg = Math.round(U.wrap360(c)) % 360;
    logOrders();
    UI.update();
  };
  app.orderSpeed = function (s) {
    if (!app.world) return;
    app.world.own.ordSpd = U.clamp(Math.round(s), 0, 28);
    logOrders();
    UI.update();
  };

  app.splitAt = function (tr, t) {
    var nt = app.world.split(tr.id, t);
    if (!nt) {
      app.toast('Nothing to split there. Pick a time inside ' + tr.name + "'s data.", 'warn');
      return;
    }
    app.mode = 'select';
    app.activeId = nt.id;
    Audio.play('click');
    UI.update();
  };
  app.mergeChosen = function () {
    var ids = Array.from(app.chosen);
    var act = app.activeTrack();
    if (ids.length === 1 && act && ids[0] !== act.id) ids.push(act.id);
    if (ids.length < 2) {
      app.toast('Ctrl+click two or more tracks in the list, then merge.', 'warn');
      return;
    }
    var keep = app.world.merge(ids);
    app.chosen.clear();
    if (keep) app.activeId = keep.id;
    Audio.play('click');
    UI.update();
  };
  app.dropActive = function () {
    var tr = app.activeTrack();
    if (!tr) return;
    app.world.drop(tr.id);
    app.chosen.delete(tr.id);
    app.activeId = null;
    UI.update();
  };
  app.adjust = function (kind, v) {
    var tr = app.activeTrack();
    if (!tr || !tr.sol) return;
    if (kind === 'crs') app.world.adjCourse(tr, v);
    else if (kind === 'spd') app.world.adjSpeed(tr, v);
    else app.world.adjRange(tr, v);
  };

  app.fire = function () {
    var w = app.world;
    var tr = app.activeTrack();
    if (!w || !tr) {
      app.toast('Select a target track first.', 'warn');
      return;
    }
    if (tr.status === 'SUNK') return;
    if (!w.readyTube()) {
      app.toast('No tube ready.', 'warn');
      return;
    }
    w.fire(tr, app.enableOffset);
  };
  app.weaponCmd = function (id, cmd) {
    var w = app.world;
    var t = w.torps.filter(function (x) {
      return x.id === id;
    })[0];
    if (!t) return;
    if (cmd === 'upd' && !w.updateWire(t, app.enableOffset)) app.toast('No valid solution on ' + t.trackName + ' to send.', 'warn');
    if (cmd === 'enb' && w.enableNow(t)) Audio.play('click');
  };
  app.updateNewest = function () {
    var w = app.world;
    for (var i = w.torps.length - 1; i >= 0; i--) {
      var t = w.torps[i];
      if (t.state !== 'DONE' && t.wire && t.state !== 'HOMING') {
        app.weaponCmd(t.id, 'upd');
        return;
      }
    }
    app.toast('No wire-guided weapon to update.', 'warn');
  };

  // ---- exercise lifecycle ----------------------------------------------------
  app.begin = function () {
    Audio.init();
    savePrefs();
    UI.show('start', false);
    stopStartBg();
    app.newExercise();
  };
  app.toStart = function () {
    app.running = false;
    UI.show('start', true);
    startBg();
  };
  app.newExercise = function () {
    var w = new World({ difficulty: app.setup.difficulty, contacts: app.setup.contacts });
    app.world = w;
    app.wf.reset();
    UI.clearLog();
    UI.resetCaches();
    app.activeId = null;
    app.chosen.clear();
    app.mode = 'select';
    app.showTruth = false;
    app.follow = true;
    app.paused = false;
    app.tc = 8;
    app.acc = 0;
    app.overShown = false;
    app.geo.view.scale = 0.022;
    w.preroll();
    app.loggedHdg = w.own.ordHdg;
    app.loggedSpd = w.own.ordSpd;
    app.world.emit({
      src: 'CONN',
      text: 'Exercise ' + w.diff.label + ', seed ' + w.seed + '. Own ship course ' + U.fmtBrg(w.own.hdg) + ', ' + w.own.spd + ' knots, 150 feet. You have the TMA station.',
    });
    var first = w.tracks.filter(function (t) {
      return t.status === 'TRK';
    })[0];
    if (first) app.activeId = first.id;
    app.running = true;
    UI.update();
  };

  function drain() {
    var w = app.world;
    for (var i = 0; i < w.rows.length; i++) app.wf.push(w.rows[i]);
    w.rows.length = 0;
    if (!w.events.length) return;
    var evs = w.events.splice(0, w.events.length);
    evs.forEach(function (ev) {
      UI.log(ev);
      if (ev.sound) Audio.play(ev.sound);
      if (ev.say) Audio.say(ev.say);
      if (ev.kind === 'report') {
        var r = ev.report;
        var head = r.result === 'HIT' ? 'TARGET DESTROYED' : r.result === 'HIT_OTHER' ? 'WRONG SHIP HIT' : 'MISS';
        var body = r.sol ? 'Solution grade <b style="display:inline;font-size:inherit" class="grade-' + r.grade + '">' + r.grade + '</b>: course off ' + r.errCrs.toFixed(0) + '&deg;, speed off ' + r.errSpd.toFixed(1) + ' kt, range off ' + r.errRng.toFixed(0) + '%.' : 'Snap shot down the bearing, no solution to grade.';
        UI.toast('<b>' + r.w + ' ' + head + '</b>' + body, r.result === 'HIT' ? 'good' : 'bad', 9000);
      }
      if (ev.kind === 'over' && !app.overShown) {
        app.overShown = true;
        setTimeout(UI.showDebrief, 2500);
      }
      if (ev.trackId && app.activeId === null) app.activeId = ev.trackId;
    });
  }

  function updateListen() {
    var w = app.world;
    var tr = app.activeTrack();
    var last = tr && w.lastSample(tr);
    if (!app.listen || !last || tr.status !== 'TRK') {
      Audio.setListen(false);
      return;
    }
    var c = w.contacts[last.cid];
    var rpm = Math.max(10, c.spd * c.tpk);
    Audio.setListen(true, ((rpm / 60) * c.blades) / 2, c.se);
  }

  // ---- frame loop --------------------------------------------------------------
  var last = performance.now();
  var lastUi = 0;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    var w = app.world;
    if (w && app.running && !app.paused) {
      app.acc += dt * app.tc;
      var steps = 0;
      while (app.acc >= World.DT && steps < 300) {
        w.step(World.DT);
        app.acc -= World.DT;
        steps++;
      }
      if (steps >= 300) app.acc = 0;
    }
    if (w) drain();
    app.geo.draw();
    app.wf.draw();
    app.dots.draw();
    app.dial.draw();
    if (w && now - lastUi > 150) {
      lastUi = now;
      UI.update();
      Audio.setSpeed(w.own.spd);
      updateListen();
    }
    requestAnimationFrame(frame);
  }

  // ---- start-screen backdrop: a slow phosphor waterfall --------------------------
  var bgRaf = null;
  function startBg() {
    var cv = document.getElementById('startBg');
    var ctx = cv.getContext('2d');
    var W = 240,
      H = 135;
    cv.width = W;
    cv.height = H;
    var img = ctx.createImageData(W, 1);
    var traces = [
      { b: 0.22, v: 0.00025, a: 0.9 },
      { b: 0.58, v: -0.0004, a: 0.7 },
      { b: 0.81, v: 0.00012, a: 0.5 },
    ];
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function row() {
      ctx.drawImage(cv, 0, 0, W, H - 1, 0, 1, W, H - 1);
      for (var x = 0; x < W; x++) {
        var v = Math.random() * 0.25;
        for (var k = 0; k < traces.length; k++) {
          var d = (x / W - traces[k].b) * W;
          v += traces[k].a * Math.exp(-(d * d) / 2) * (0.6 + Math.random() * 0.6);
        }
        var g = Math.min(255, v * 220);
        img.data[x * 4] = g * 0.25;
        img.data[x * 4 + 1] = g;
        img.data[x * 4 + 2] = g * 0.55;
        img.data[x * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      traces.forEach(function (t) {
        t.b += t.v;
      });
    }
    function tick() {
      row();
      bgRaf = setTimeout(tick, 70);
    }
    ctx.fillStyle = '#020806';
    ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < H; i++) row();
    if (!reduce) tick();
  }
  function stopStartBg() {
    clearTimeout(bgRaf);
    bgRaf = null;
  }

  function boot() {
    loadPrefs();
    app.geo = new TMA.GeoPlot(document.getElementById('geo'), app);
    app.wf = new TMA.Waterfall(document.getElementById('wf'), app);
    app.dots = new TMA.DotStack(document.getElementById('dots'), app);
    app.dial = new TMA.Dial(document.getElementById('dial'), app);
    UI.init(app);
    // the console runs behind the start card so the first frame shows the station
    var w = new World({ difficulty: app.setup.difficulty, contacts: app.setup.contacts });
    w.preroll();
    w.events.length = 0;
    app.world = w;
    app.activeId = w.tracks.length ? w.tracks[0].id : null;
    startBg();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
