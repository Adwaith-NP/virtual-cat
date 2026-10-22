# 🐱 Desktop Cat

A small white cat that lives on your desktop — on **Windows, macOS and Linux**.
It walks around on top of everything (on every monitor), has needs and moods,
makes a mess, and you take care of it while you keep working underneath.

Everything is drawn in code (no sprite sheets) and every sound is synthesized,
so the app has no art or audio assets.

## Features

| | |
|---|---|
| **Always on top** | Transparent click-through overlay on every display — you can use your computer normally; only the cat and its things catch the mouse. |
| **Multi-monitor** | The cat walks across screen borders and visits your other displays. |
| **Pick it up** | Drag the cat: it's carried by the scruff like a mother cat carries a kitten, swings as you move, and drops/lands on its feet where you let go. Shake it and it gets dizzy. Throw it and it's annoyed. |
| **Right-click menu** | Right-click anywhere (or on the cat) for the care menu: needs meters + Feed / Clean up / Sleep / Play / Fix the screen / Call / Quiet time / Cat Home. |
| **Hunger** | Feed fish, kibble, chicken or milk (a bowl appears where you right-clicked), or give a treat by hand. A hungry cat begs, gets thin and sad; if it starves too long it becomes weak and **dies** — a ghost floats up and a R.I.P. tombstone appears. You can lay flowers and adopt a new kitten. |
| **Poop** | It finds a spot, poops, kicks "litter" and runs off. Use *Clean up → Scoop poop*: your cursor becomes a scoop, click each poop to collect it. Old poop stinks and attracts flies. |
| **Sleep** | A sleepy cat yawns and shows a 🌙 bubble. *Sleep* places a cozy bed; the cat walks over, turns around twice, curls up and sleeps (Zzz). If you don't, it collapses on the floor and wakes up grumpy. |
| **Mouse chase** | *Play → Mouse chase*: your cursor becomes a toy mouse. The cat stalks, wiggles its butt, pounces — hold still and it catches you! |
| **Mischief** | It scratches the screen (claw marks on the "glass") and drags pretend files around, sometimes knocking them off the screen. Fix with *Fix the screen → Repair scratches* (spray bottle) and *Tidy up files*. A scratching post saves your screen. |
| **More play** | Laser pointer, yarn ball (drag & throw it), cardboard box (it hides and peeks out), catnip (silly zoomies), brush (stroke it). |
| **Emotions** | Thought bubbles show what it needs (🐟 🌙 💩 🧶 ➕ ❤️), plus faces: happy, love, sad, begging sparkle-eyes, sleepy, angry hiss, scared, dizzy, proud… and ears/tail that move with mood. |
| **A real cat** | Walks, runs, sits, loafs, grooms, stretches, yawns, slow-blinks at you, purrs when stroked, watches your cursor, gets the zoomies, rolls over, swats when you boop it too often, naps more at night. |
| **Cat Home** | Window with live stats, quick care buttons, counters, settings and a memorial of past cats. |
| **Quiet time / Hide** | For meetings or screen sharing: the cat naps in a corner (no needs, no mess), or hide it completely. |
| **Saves** | Everything is saved; time passes gently while the app is closed (never fatally). |

## Run it

Requires **Node.js 22+** (Electron 45's installer needs it).

```bash
cd desktop-cat
npm install
npm start
```

The cat appears on your screen. Find the app in the **menu-bar / system-tray** icon (cat face).

### macOS: right-click anywhere

macOS only lets apps see clicks outside their own windows with **Accessibility**
permission. Without it everything still works — right-click **the cat**, use the
menu-bar icon, or press **⌘⌥⇧K** — but to right-click *anywhere*, open the cat's
menu → **Enable right-click anywhere…** and switch on *Desktop Cat* (or *Electron*
when running from source) in System Settings → Privacy & Security → Accessibility.

On Windows and Linux no permission is needed.

## Build installers

```bash
npm run dist:mac     # .dmg + .zip   (on a Mac)
npm run dist:win     # .exe installer + portable .exe (on Windows)
npm run dist:linux   # .AppImage + .deb (on Linux)
```

Each platform builds best on its own OS. The included GitHub Actions workflow
(`.github/workflows/build.yml`) builds all three: push a tag like `v1.0.0` or run
it manually, then download the installers from the run's *Artifacts*.

Builds are unsigned. On macOS the first launch needs right-click → *Open*; on
Windows, SmartScreen may ask you to confirm.

## Controls

| Do this | What happens |
|---|---|
| Right-click (anywhere / on the cat) | Care menu |
| ⌘⌥⇧K / Ctrl+Alt+Shift+K | Care menu at the cursor |
| Drag the cat | Carry it by the scruff, drop it anywhere |
| Move the mouse back & forth over it | Petting → purring + hearts |
| Click the cat | Boop (too many → angry!) |
| Hover the cat | Mini status card |
| Esc | Put away the current tool (needs the global hook) |

## Settings (Cat Home → Settings)

Fur color (snow white, cream, silver, ginger, midnight), eye color (blue, green,
amber, odd-eyed), size, **time speed** (relaxed / normal / fast / turbo — turbo is
handy to see hunger, poop and sleep quickly), mischief level, how the menu opens,
sounds & volume, notifications, thought bubbles, using your real Desktop file
*names* for the pretend files (names only — your files are never touched), and
start at login.

## Platform notes

- **Linux:** needs a compositor for transparency. The app runs through X11/XWayland;
  on a pure Wayland session cursor-following features may be limited — an
  "on Xorg" session works best. The tray icon needs AppIndicator support (GNOME:
  the *AppIndicator* extension). Right-clicking the cat always works.
- **Linux without a compositor** (e.g. plain i3/openbox): transparent windows can't
  work and the overlay would look black — run a compositor such as `picom`.
- **Windows:** the overlay is 1px shorter than the screen so Windows doesn't treat it
  as a fullscreen app (which would hide the taskbar and mute notifications).

## How it works

```
src/main/main.js      Electron main: overlays per display, click-through, tray, menu, IPC, autosave
src/main/world.js     Simulation: needs, the cat's brain (generator "tasks"), entities, tools, input
src/main/geometry.js  Multi-monitor union, clamping, routing across screen edges
src/main/hook.js      Optional global mouse/keyboard hook (uiohook-napi, listen-only)
src/renderer/catArt.js Procedural cat: skeleton, 2-bone legs, 27 poses, pose blending, faces
src/renderer/props.js  Bowls, poop, bed, box, post, yarn, files, tombstone, scratches, tools, particles
src/renderer/overlay.js Draws the world as depth-sorted canvas sprites; adaptive frame rate
src/renderer/menu.js   The right-click care menu
src/renderer/sound.js  Synthesized meows, purr, crunch, squeak… (Web Audio)
src/home/              The Cat Home window
```

The simulation runs in the main process at 30–60 Hz and streams snapshots to the
overlay windows, which only draw. An overlay stops being click-through only while
the cursor is over something interactive, so the rest of the screen stays yours.

### Developing

- `npm test` — headless simulation + multi-monitor crossing tests.
- `dev/gallery.html` — every pose, face and prop in one page (serve the folder,
  e.g. `python3 -m http.server`, then open `/dev/gallery.html`).
- `npm run dev` — opens Cat Home on start. With `CAT_CMD_FILE=/tmp/cmd.txt` set,
  lines written to that file drive the app (`feed {"kind":"fish"}`, `set {"food":5}`,
  `task {"name":"taskZoomies"}`, `capture {"dir":"/tmp"}` …) — see `devPoll` in `main.js`.
- `CAT_USER_DATA=/some/dir` uses a separate save; `DESKTOP_CAT_NO_HOOK=1` skips the global hook.

## Ideas for later

Kitten → adult growth, more breeds/patterns, climbing window edges, sitting on top of
windows, reacting to typing, day/night outfits, achievements, multiple cats that play
together, sharing cats between computers.
