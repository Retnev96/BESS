/* DOM side of the console: panels, track list, log, overlays and keys. */
'use strict';
(function () {
  var U = TMA.U;
  var World = TMA.World;

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function setText(el, txt) {
    if (el.textContent !== txt) el.textContent = txt;
  }

  var UI = {};
  var app = null;
  var toastTimer = null;
  var lastTrackHtml = '';
  var lastWpnHtml = '';
  var lastTubesHtml = '';

  UI.init = function (a) {
    app = a;

    // header
    $('btnPause').addEventListener('click', function () {
      app.togglePause();
    });
    document.querySelectorAll('.tcb').forEach(function (b) {
      b.addEventListener('click', function () {
        app.setTc(+b.dataset.tc);
      });
    });
    $('btnSound').addEventListener('click', function () {
      app.setSound(!TMA.Audio.state.sound);
    });
    $('btnVoice').addEventListener('click', function () {
      app.setVoice(!TMA.Audio.state.voice);
    });
    $('btnTruth').addEventListener('click', function () {
      app.toggleTruth();
    });
    $('btnHelp').addEventListener('click', function () {
      UI.show('help', true);
    });
    $('btnEnd').addEventListener('click', function () {
      UI.showDebrief();
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.show(b.dataset.close, false);
      });
    });
    $('btnNew').addEventListener('click', function () {
      UI.show('debrief', false);
      app.toStart();
    });

    // own ship
    document.querySelectorAll('[data-crs]').forEach(function (b) {
      b.addEventListener('click', function () {
        app.orderCourse(app.world.own.ordHdg + +b.dataset.crs);
      });
    });
    var inCrs = $('inCrs');
    inCrs.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = parseInt(inCrs.value, 10);
        if (!isNaN(v)) app.orderCourse(v);
        inCrs.blur();
      }
      e.stopPropagation();
    });
    inCrs.addEventListener('blur', function () {
      inCrs.value = U.fmtBrg(app.world ? app.world.own.ordHdg : 0);
    });
    document.querySelectorAll('[data-spd]').forEach(function (b) {
      b.addEventListener('click', function () {
        app.orderSpeed(+b.dataset.spd);
      });
    });

    // tracks
    $('trackList').addEventListener('click', function (e) {
      var row = e.target.closest('.trk');
      if (!row) return;
      var id = +row.dataset.id;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.target.classList.contains('chk')) app.toggleChosen(id);
      else app.setActive(id);
      lastTrackHtml = '';
      UI.update();
    });
    $('btnMerge').addEventListener('click', function () {
      app.mergeChosen();
    });
    $('btnSplit').addEventListener('click', function () {
      app.setMode(app.mode === 'split' ? 'select' : 'split');
    });
    $('btnDrop').addEventListener('click', function () {
      app.dropActive();
    });
    $('btnListen').addEventListener('click', function () {
      app.toggleListen();
    });

    // plot toolbar
    document.querySelectorAll('.tool').forEach(function (b) {
      b.addEventListener('click', function () {
        app.setMode(b.dataset.mode);
      });
    });
    document.querySelectorAll('.liv').forEach(function (b) {
      b.addEventListener('click', function () {
        app.lineIv = +b.dataset.iv;
        UI.update();
      });
    });
    $('btnAll').addEventListener('click', function () {
      app.showAll = !app.showAll;
      UI.update();
    });
    $('btnFollow').addEventListener('click', function () {
      app.setFollow(!app.follow);
    });
    $('btnZoomIn').addEventListener('click', function () {
      app.geo.zoom(1.3);
    });
    $('btnZoomOut').addEventListener('click', function () {
      app.geo.zoom(1 / 1.3);
    });
    document.querySelectorAll('.dsc').forEach(function (b) {
      b.addEventListener('click', function () {
        app.dotScale = +b.dataset.ds;
        UI.update();
      });
    });

    // solution tuning
    document.querySelectorAll('[data-adj]').forEach(function (b) {
      b.addEventListener('click', function () {
        app.adjust(b.dataset.adj, +b.dataset.v);
      });
    });
    $('btnClearSol').addEventListener('click', function () {
      var tr = app.activeTrack();
      if (tr) tr.sol = null;
    });

    // weapons
    var enOff = $('enOff');
    enOff.addEventListener('input', function () {
      app.enableOffset = +enOff.value;
      setText($('enOffV'), (app.enableOffset / 1000).toFixed(1) + ' KYD');
    });
    enOff.addEventListener('keydown', function (e) {
      e.stopPropagation();
    });
    $('btnFire').addEventListener('click', function () {
      app.fire();
    });
    $('weapons').addEventListener('click', function (e) {
      var b = e.target.closest('[data-w]');
      if (!b) return;
      app.weaponCmd(+b.dataset.w, b.dataset.cmd);
    });

    // start screen
    document.querySelectorAll('[data-diff]').forEach(function (b) {
      b.addEventListener('click', function () {
        app.setup.difficulty = b.dataset.diff;
        UI.renderSetup();
      });
    });
    document.querySelectorAll('[data-n]').forEach(function (b) {
      b.addEventListener('click', function () {
        app.setup.contacts = +b.dataset.n;
        UI.renderSetup();
      });
    });
    $('stSound').addEventListener('click', function () {
      app.setSound(!TMA.Audio.state.sound);
    });
    $('stVoice').addEventListener('click', function () {
      app.setVoice(!TMA.Audio.state.voice);
    });
    $('btnBegin').addEventListener('click', function () {
      app.begin();
    });

    window.addEventListener('keydown', onKey);
    UI.renderSetup();
  };

  var DIFF_NOTES = {
    easy: 'Merchant shipping on steady courses. Clean bearings, no tracker swaps, and DEMON gives you a speed estimate.',
    normal: 'Mixed traffic. Trawlers change course, warships run from torpedoes, and the tracker may swap contacts when bearings cross.',
    hard: 'Noisier bearings, frequent tracker drops and swaps, maneuvering targets and a quiet submarine. DEMON gives raw RPM only.',
  };

  UI.renderSetup = function () {
    document.querySelectorAll('[data-diff]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.diff === app.setup.difficulty);
    });
    document.querySelectorAll('[data-n]').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.n === app.setup.contacts);
    });
    setText($('diffNote'), DIFF_NOTES[app.setup.difficulty]);
    UI.syncToggles();
  };

  UI.syncToggles = function () {
    var s = TMA.Audio.state;
    ['btnSound', 'stSound'].forEach(function (id) {
      $(id).classList.toggle('on', s.sound);
    });
    ['btnVoice', 'stVoice'].forEach(function (id) {
      $(id).classList.toggle('on', s.voice);
    });
  };

  UI.show = function (id, on) {
    $(id).hidden = !on;
  };
  UI.isOpen = function (id) {
    return !$(id).hidden;
  };

  UI.toast = function (html, kind, ms) {
    var el = $('toast');
    el.innerHTML = html;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
    }, ms || 4500);
  };

  UI.clearLog = function () {
    $('log').innerHTML = '';
  };

  UI.log = function (ev) {
    var li = document.createElement('li');
    li.className = (ev.level || '') + ' src-' + String(ev.src || '').replace(/\s+/g, '_');
    li.innerHTML = '<span class="lt">' + U.fmtClock(ev.t) + '</span><span class="ls">' + esc(ev.src || '') + '</span><span class="lx">' + esc(ev.text) + '</span>';
    var log = $('log');
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 120) log.removeChild(log.lastChild);
  };

  // ---- periodic refresh ----------------------------------------------------
  UI.update = function () {
    var w = app.world;
    if (!w) return;
    var o = w.own;
    var act = app.activeTrack();

    // header
    setText($('clock'), U.fmtClock(w.t));
    $('btnPause').classList.toggle('active', app.paused);
    document.querySelectorAll('.tcb').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.tc === app.tc && !app.paused);
    });
    $('btnTruth').classList.toggle('on', app.showTruth);
    var trk = w.tracks.some(function (t) {
      return t.status === 'TRK';
    });
    led('ledSonar', trk ? 'on' : '');
    var ai = act ? w.solInfo(act) : null;
    led('ledFcs', ai && ai.valid ? (ai.legs > 1 && ai.rms < 1.2 ? 'on' : 'warn') : '');
    var running = w.torps.some(function (t) {
      return t.state !== 'DONE';
    });
    led('ledWpn', running ? 'alert' : w.readyTube() ? 'on' : 'warn');
    var hits = w.reports.filter(function (r) {
      return r.result === 'HIT' || r.result === 'HIT_OTHER';
    }).length;
    setText($('score'), 'HITS ' + hits + ' / SHOTS ' + w.torps.length);

    // own ship
    setText($('roHdg'), U.fmtBrg(o.hdg));
    setText($('roOrdHdg'), U.fmtBrg(o.ordHdg));
    setText($('roSpd'), o.spd.toFixed(1));
    setText($('roOrdSpd'), String(o.ordSpd));
    setText($('roNoise'), o.spd < 8 ? 'LOW' : o.spd < 13 ? 'MODERATE' : o.spd < 20 ? 'HIGH' : 'FLOW NOISE');
    $('roNoise').style.color = o.spd < 8 ? '' : o.spd < 13 ? 'var(--warn)' : 'var(--alert)';
    var st = Math.abs(o.rate) > 0.05 ? (o.rate > 0 ? 'TURNING RIGHT' : 'TURNING LEFT') : Math.abs(o.spd - o.ordSpd) > 0.1 ? (o.spd < o.ordSpd ? 'ACCELERATING' : 'SLOWING') : 'STEADY';
    setText($('ownState'), st);
    if (document.activeElement !== $('inCrs')) $('inCrs').value = U.fmtBrg(o.ordHdg);
    document.querySelectorAll('[data-spd]').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.spd === o.ordSpd);
    });

    // tool state
    document.querySelectorAll('.tool').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === app.mode);
    });
    $('btnSplit').classList.toggle('active', app.mode === 'split');
    document.querySelectorAll('.liv').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.iv === app.lineIv);
    });
    $('btnAll').classList.toggle('on', app.showAll);
    $('btnFollow').classList.toggle('on', app.follow);
    $('btnListen').classList.toggle('on', app.listen);
    document.querySelectorAll('.dsc').forEach(function (b) {
      b.classList.toggle('active', +b.dataset.ds === app.dotScale);
    });
    $('btnMerge').disabled = app.chosen.size < 2;
    $('btnDrop').disabled = !act;

    renderTracks(w, act);
    renderSolution(w, act, ai);
    renderWeapons(w, act);
  };

  function led(id, cls) {
    var el = $(id);
    var want = 'led' + (cls ? ' ' + cls : '');
    if (el.className !== want) el.className = want;
  }

  function renderTracks(w, act) {
    var html = '';
    if (!w.tracks.length) html = '<div class="trk-empty">No contacts held. Sonar is listening.</div>';
    w.tracks.forEach(function (tr) {
      var last = w.lastSample(tr);
      var br = w.bearingRate(tr);
      var info = w.solInfo(tr);
      var dm = w.demon(tr);
      var cls = dm && !dm.pending ? (dm.cls || dm.blades + '-BLADE') : 'CLASSIFYING';
      var sol = info && info.valid ? 'SOL ' + U.fmtBrg(info.crs) + '/' + info.spd.toFixed(1) + '/' + U.fmtKyd(info.rng) + 'K' : 'NO SOL';
      var age = last ? w.t - last.t : 0;
      html +=
        '<div class="trk' + (act === tr ? ' sel' : '') + (app.chosen.has(tr.id) ? ' chosen' : '') + '" data-id="' + tr.id + '">' +
        '<span class="chk" title="Pick for merge"></span>' +
        '<span class="nm" style="color:' + tr.color + '">' + tr.name + '</span>' +
        '<span class="l1">' + (last ? U.fmtBrg(last.b) + '&deg; ' : '---&deg; ') +
        (br === null ? '' : (br >= 0 ? 'R ' : 'L ') + Math.abs(br).toFixed(1) + '&deg;/m') + '</span>' +
        '<span class="st ' + tr.status + '">' + tr.status + (tr.status === 'HOLD' || tr.status === 'LOST' ? ' ' + U.fmtMinSec(age) : '') + '</span>' +
        '<span class="l2">' + cls + ' &middot; ' + sol + '</span>' +
        '</div>';
    });
    if (html !== lastTrackHtml) {
      $('trackList').innerHTML = html;
      lastTrackHtml = html;
    }
  }

  function renderSolution(w, act, info) {
    setText($('solTrack'), act ? act.name + ' · ' + act.status + ' · ' + act.samples.length + ' BEARINGS' : 'NO TRACK SELECTED');
    var v = info && info.valid;
    setText($('soCrs'), v ? U.fmtBrg(info.crs) : '---');
    setText($('soSpd'), v ? info.spd.toFixed(1) : '--.-');
    setText($('soRng'), v ? U.fmtKyd(info.rng) : '--.-');
    setText($('soBrg'), v ? U.fmtBrg(info.brg) : '---');
    var br = act ? w.bearingRate(act) : null;
    setText($('soBr'), br === null ? '--' : (br >= 0 ? 'R' : 'L') + Math.abs(br).toFixed(2) + '°/M');
    setText($('soRms'), v ? info.rms.toFixed(2) + '°' : '--');

    var obs = $('chipObs');
    var fit = $('chipFit');
    if (v) {
      obs.className = 'chip ' + (info.legs > 1 ? 'good' : 'warn');
      setText(obs, info.legs > 1 ? 'OBSERVABILITY GOOD · 2+ LEGS' : 'OBSERVABILITY LOW · 1 LEG');
      var drifting = Math.abs(info.drift) > 1;
      fit.className = 'chip ' + (info.rms < 0.8 && !drifting ? 'good' : info.rms < 1.6 ? 'warn' : 'bad');
      setText(fit, drifting ? 'FIT DRIFTING' : info.rms < 0.8 ? 'FIT GOOD' : info.rms < 1.6 ? 'FIT FAIR' : 'FIT POOR');
    } else {
      obs.className = 'chip';
      fit.className = 'chip';
      setText(obs, 'OBSERVABILITY --');
      setText(fit, 'FIT --');
    }
    setText($('advisor'), advice(w, act, info));

    var dm = act ? w.demon(act) : null;
    var dtxt = '';
    if (dm && dm.pending) dtxt = 'DEMON  classifying, ' + Math.ceil(dm.need) + ' s of data needed';
    else if (dm) {
      dtxt = 'DEMON  ' + dm.shafts + ' SHAFT' + (dm.shafts > 1 ? 'S' : '') + '  ' + dm.blades + ' BLADES  ' + dm.rpm + ' RPM';
      if (dm.cls) dtxt += '  ·  ' + dm.cls + ' TPK ' + dm.tpk[0] + '-' + dm.tpk[1];
      if (dm.estSpd !== undefined) dtxt += '  ·  EST ' + dm.estSpd.toFixed(1) + ' KT';
    }
    setText($('demon'), dtxt);
  }

  function advice(w, act, info) {
    if (!w.tracks.length) return 'Waiting for contacts. Sonar is listening.';
    if (!act) return 'Select a contact in the list or click its bearing line on the plot.';
    if (act.status === 'SUNK') return 'This contact is destroyed. Select another.';
    if (!info) return 'Press R, then drag from an early bearing line of ' + act.name + ' to a recent one.';
    if (!info.valid) return 'The ruler ends must sit on different bearing lines.';
    if (info.legs < 2) return 'One own-ship leg: near-and-slow and far-and-fast rulers fit equally well. Turn 40 to 90 degrees and let a few minutes of new bearings build.';
    if (Math.abs(info.drift) > 1) return 'The dot stack leans: recent bearings fall ' + (info.drift > 0 ? 'right' : 'left') + ' of the solution. Adjust course, speed or range until the dots stand straight.';
    if (info.rms > 1.6) return 'Wide scatter. Look for a maneuver or tracker swap in the dot stack and split there, or refine the ruler.';
    if (info.rng > World.TORP.maxRun * 0.85) return 'Solution is beyond weapon range. Close the target before shooting.';
    return 'Solution fits on two legs. Shoot when ready, or keep refining.';
  }

  function renderWeapons(w, act) {
    var tubes = '';
    w.tubes.forEach(function (tb) {
      var lbl = tb.state === 'READY' ? 'RDY' : tb.state === 'RELOAD' ? 'RLD ' + U.fmtMinSec(tb.t - w.t) : 'EMPTY';
      tubes += '<div class="tube ' + tb.state + '">T' + tb.n + ' ' + lbl + '</div>';
    });
    if (tubes !== lastTubesHtml) {
      $('tubes').innerHTML = tubes;
      lastTubesHtml = tubes;
    }
    setText($('wpnReserve'), 'RELOADS ' + w.reserve);
    var pre = act && act.status !== 'SUNK' ? w.presets(act, app.enableOffset) : null;
    setText($('pzTgt'), act ? act.name : '--');
    setText($('pzGyro'), pre ? U.fmtBrg(pre.gyro) : '---');
    setText($('pzInt'), pre && pre.idist ? U.fmtKyd(pre.idist) + ' KYD' : pre ? 'SNAP' : '--');
    setText($('pzTti'), pre && pre.tgo ? U.fmtMinSec(pre.tgo) : '--');
    setText($('pzEn'), pre ? U.fmtKyd(pre.enable) + ' KYD' : '--');
    $('pzInt').style.color = pre && pre.outOfRange ? 'var(--alert)' : '';
    var tube = w.readyTube();
    var fb = $('btnFire');
    fb.disabled = !tube || !pre;
    setText(fb, !pre ? 'FIRE' : !tube ? 'RELOADING' : pre.mode === 'SNAP' ? 'SNAP SHOT T' + tube.n : 'FIRE  T' + tube.n);

    var html = '';
    w.torps.forEach(function (t) {
      if (t.state === 'DONE' && w.t - t.launchT > 60 && w.t - (t.doneT || 0) > 30) return;
      var info =
        t.state === 'RTE'
          ? 'ENABLE IN ' + U.fmtKyd(Math.max(0, t.enable - t.run)) + 'K'
          : t.state === 'DONE'
            ? t.result || 'DONE'
            : 'RUN ' + U.fmtKyd(t.run) + 'K';
      html +=
        '<div class="wrow"><span class="ws">' + t.name + ' ' + t.state + '</span><span class="wi">' + t.trackName + ' · ' + info + (t.wire ? ' · WIRE' : ' · NO WIRE') + '</span>' +
        (t.state !== 'DONE' && t.wire && t.state !== 'HOMING' ? '<button class="key" data-w="' + t.id + '" data-cmd="upd" title="Re-aim from the current solution (U)">UPDATE</button>' : '') +
        (t.state === 'RTE' && t.wire ? '<button class="key" data-w="' + t.id + '" data-cmd="enb" title="Enable the seeker now">ENABLE</button>' : '') +
        '</div>';
    });
    if (html !== lastWpnHtml) {
      $('weapons').innerHTML = html;
      lastWpnHtml = html;
    }
  }

  UI.resetCaches = function () {
    lastTrackHtml = lastWpnHtml = lastTubesHtml = '';
  };

  // ---- debrief -----------------------------------------------------------------
  UI.showDebrief = function () {
    var w = app.world;
    if (!w) return;
    var rows = w.debrief();
    var reps = w.reports;
    var hits = reps.filter(function (r) {
      return r.result === 'HIT';
    }).length;
    var graded = reps.filter(function (r) {
      return r.grade !== '-';
    });
    var avg = graded.length
      ? Math.round(
          graded.reduce(function (s, r) {
            return s + r.score;
          }, 0) / graded.length
        )
      : null;
    var avgGrade = avg === null ? '-' : World.gradeOf(avg);
    var html = '<div class="db-sum">' +
      '<div><span class="lbl">SHOTS</span><b>' + w.torps.length + '</b></div>' +
      '<div><span class="lbl">HITS ON TARGET</span><b>' + hits + '</b></div>' +
      '<div><span class="lbl">MEAN SOLUTION GRADE</span><b class="grade-' + avgGrade + '">' + avgGrade + (avg === null ? '' : ' <small class="data">' + avg + '</small>') + '</b></div>' +
      '<div><span class="lbl">DIFFICULTY</span><b>' + w.diff.label + '</b></div>' +
      '</div>';
    html += '<h3 class="lbl">Contacts: truth against your best solution</h3><div class="db-wrap"><table class="db-table"><tr><th>CONTACT</th><th>STATUS</th><th>TRACK</th><th>TRUE CSE/SPD</th><th>YOUR CSE/SPD</th><th>TRUE RNG</th><th>YOUR RNG</th></tr>';
    rows.forEach(function (r) {
      html += '<tr><td class="txt">' + esc(r.type) + '</td><td>' + (r.alive ? 'AFLOAT' : 'SUNK') + '</td><td>' + (r.track || '--') + '</td>' +
        '<td>' + U.fmtBrg(r.crs) + ' / ' + r.spd.toFixed(1) + '</td>' +
        '<td>' + (r.solCrs !== undefined ? U.fmtBrg(r.solCrs) + ' / ' + r.solSpd.toFixed(1) : '--') + '</td>' +
        '<td>' + (r.alive ? U.fmtKyd(r.rng) + 'K' : '--') + '</td>' +
        '<td>' + (r.solRng !== undefined ? U.fmtKyd(r.solRng) + 'K' : '--') + '</td></tr>';
    });
    html += '</table></div>';
    if (reps.length) {
      html += '<h3 class="lbl">Shots: solution at launch against truth</h3><div class="db-wrap"><table class="db-table"><tr><th>WEAPON</th><th>TRACK</th><th>RESULT</th><th>CSE ERR</th><th>SPD ERR</th><th>RNG ERR</th><th>GRADE</th></tr>';
      reps.forEach(function (r) {
        var res = r.result === 'HIT' ? 'HIT' : r.result === 'HIT_OTHER' ? 'WRONG SHIP' : 'MISS';
        html += '<tr><td>' + r.w + '</td><td>' + r.track + '</td><td>' + res + '</td>' +
          '<td>' + (r.errCrs !== undefined ? r.errCrs.toFixed(0) + '°' : 'SNAP') + '</td>' +
          '<td>' + (r.errSpd !== undefined ? r.errSpd.toFixed(1) + ' KT' : '--') + '</td>' +
          '<td>' + (r.errRng !== undefined ? r.errRng.toFixed(0) + '%' : '--') + '</td>' +
          '<td class="grade-' + r.grade + '">' + r.grade + (r.truthShown ? ' (TRUTH ON)' : '') + '</td></tr>';
      });
      html += '</table></div>';
    }
    var running = w.torps.filter(function (t) {
      return t.state !== 'DONE';
    }).length;
    if (running) html += '<p class="lbl">' + running + ' weapon' + (running > 1 ? 's' : '') + ' still running. Close this sheet to watch them finish.</p>';
    $('dbBody').innerHTML = html;
    setText($('dbTime'), 'EXERCISE TIME ' + U.fmtClock(w.t) + '  ·  SEED ' + w.seed);
    app.showTruth = true;
    UI.show('debrief', true);
  };

  // ---- keyboard --------------------------------------------------------------------
  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (!UI.isOpen('start') && e.key === 'Escape') {
      if (UI.isOpen('help')) return UI.show('help', false);
      if (UI.isOpen('debrief')) return UI.show('debrief', false);
      app.setMode('select');
      return;
    }
    if (UI.isOpen('start')) {
      if (e.key === 'Enter') app.begin();
      return;
    }
    if (UI.isOpen('help') || UI.isOpen('debrief')) {
      if (e.key === 'h' || e.key === 'H') UI.show('help', false);
      return;
    }
    if (!app.world) return;
    var k = e.key;
    var o = app.world.own;
    var handled = true;
    switch (k) {
      case ' ':
        app.togglePause();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        app.setTc([1, 4, 8, 16, 32][+k - 1]);
        break;
      case 'a':
      case 'A':
        app.orderCourse(o.ordHdg - (e.shiftKey ? 1 : 10));
        break;
      case 'd':
      case 'D':
        app.orderCourse(o.ordHdg + (e.shiftKey ? 1 : 10));
        break;
      case 'w':
      case 'W':
        app.orderSpeed(o.ordSpd + 1);
        break;
      case 'x':
      case 'X':
        app.orderSpeed(o.ordSpd - 1);
        break;
      case 'Tab':
        app.cycleTrack(e.shiftKey ? -1 : 1);
        break;
      case 'q':
      case 'Q':
        app.setMode('select');
        break;
      case 'r':
      case 'R':
        app.setMode(app.mode === 'ruler' ? 'select' : 'ruler');
        break;
      case 's':
      case 'S':
        app.setMode(app.mode === 'split' ? 'select' : 'split');
        break;
      case 'm':
      case 'M':
        app.mergeChosen();
        break;
      case 'Delete':
      case 'Backspace':
        app.dropActive();
        break;
      case '[':
        app.adjust('crs', -2);
        break;
      case ']':
        app.adjust('crs', 2);
        break;
      case ';':
        app.adjust('spd', -0.5);
        break;
      case "'":
        app.adjust('spd', 0.5);
        break;
      case ',':
        app.adjust('rng', 0.96);
        break;
      case '.':
        app.adjust('rng', 1.04);
        break;
      case 'f':
      case 'F':
        app.fire();
        break;
      case 'u':
      case 'U':
        app.updateNewest();
        break;
      case 'l':
      case 'L':
        app.toggleListen();
        break;
      case 'c':
      case 'C':
        app.setFollow(!app.follow);
        break;
      case 't':
      case 'T':
        app.toggleTruth();
        break;
      case 'h':
      case 'H':
        UI.show('help', true);
        break;
      case '+':
      case '=':
        app.geo.zoom(1.25);
        break;
      case '-':
      case '_':
        app.geo.zoom(1 / 1.25);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      UI.update();
    }
  }

  TMA.UI = UI;
})();
