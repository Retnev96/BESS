# Bearings Only: a submarine TMA trainer

A fast, browser-based trainer for **target motion analysis (TMA)**: working out
a contact's course, speed and range from passive sonar bearings alone, then
putting a torpedo on it.

No install and no build step. Open `index.html` in a desktop browser
(Chrome, Edge or Firefox) and press **BEGIN WATCH**. Fonts load from Google
Fonts when online; everything else is local.

```bash
# or serve it, if your browser is strict about file:// pages
python -m http.server -d tma_trainer 8000   # then open http://localhost:8000
```

## The loop

1. **Sonar** hears contacts and the auto-tracker names them S1, S2, ...
   Bearings arrive every couple of seconds and are drawn on the geographic
   plot as lines from wherever your boat was at the time.
2. **Track management.** The tracker loses contacts in fades and in your
   baffles, re-acquires them under new names, and can swap two contacts when
   their bearings cross. Ctrl+click tracks and press **M** to merge; press
   **S** and click a bearing line (or a moment on the waterfall or dot stack)
   to split.
3. **The ruler.** Press **R** and drag from an old bearing line to a recent
   one. The ruler is the target's straight-line track. Each tick shows where
   the solution puts the target at the time of one bearing line, with a
   whisker to that line: green is on, red is off. Drag the ends (they snap
   to lines, Shift to place freely) or the middle until every tick sits on
   its line and the dot stack stands straight.
4. **Maneuver.** On one leg, near-and-slow and far-and-fast rulers fit
   equally well. Turn 40 to 90 degrees, let new bearings build, and only
   the true range keeps fitting.
5. **Shoot.** Press **F**. The weapon runs at 45 kt to the enable point
   computed from your solution, then snakes with its seeker on. It homes on
   anything loud in its cone, so a bad solution can hit the wrong ship.
   While the wire holds you can re-aim it from a better solution (**U**).
6. **Debrief.** Every shot is graded on the course, speed and range error of
   the solution at launch against truth.

## Displays

- **Geo plot**: bearing lines, own-ship track, ruler and solution symbols,
  weapon tracks and seeker cones, and the lead line a weapon fired now
  would take.
- **Broadband waterfall**: bearing against time, newest at the top, with
  tracker marks and the selected solution's predicted bearing overlaid.
- **Dot stack**: each bearing's error against the solution over time. A bend
  marks a target maneuver or a tracker swap.
- **DEMON**: shafts, blades and RPM after 90 s of tracking. Divide RPM by the
  class's turns per knot for a speed check.

## Difficulty

| | Easy | Normal | Hard |
|---|---|---|---|
| Contacts | merchants, tankers | plus trawlers and a warship | plus a quiet submarine |
| Bearing noise | low | medium | high |
| Tracker swaps on crossings | none | sometimes | often, plus random drops |
| Target maneuvers | none | trawlers, some others | frequent |
| Torpedo evasion | none | warships | warships and submarines |
| DEMON | speed estimate | class and TPK | raw RPM |

## Keys

`Space` pause, `1`-`5` time compression, `A`/`D` course, `W`/`X` speed,
`Tab` next track, `Q`/`R`/`S` select, ruler, split, `M` merge, `Del` drop,
`[` `]` `;` `'` `,` `.` fine-tune the solution, `F` fire, `U` update wire,
`L` listen, `C` follow own ship, `T` truth, `H` help.

## Code

Plain JavaScript in classic scripts, no dependencies:

| File | Role |
|---|---|
| `js/sim.js` | World model: own ship, contacts, passive sonar equation, auto-tracker, ruler solutions, fire control and torpedoes. No drawing, so it runs headless in Node. |
| `js/geoplot.js` | Geographic plot and the ruler interaction. |
| `js/displays.js` | Waterfall, dot stack and heading dial. |
| `js/ui.js` | Panels, track list, log, overlays and keyboard. |
| `js/audio.js` | Synthesised sound (no audio files) and spoken callouts. |
| `js/main.js` | App state and the frame loop. |
