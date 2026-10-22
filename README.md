# 🐱🦾 Desktop Buddies

Little companions that live on your desktop — on **Windows, macOS and Linux**.
Pick a character from the menu, the tray icon or the home window:

- **Cat** — a small white cat with needs, moods and a mess to clean up.
- **Iron Man** — an armored hero who lives on the floor of your screens, flies,
  and fights the enemies you drop on him.

Both live on top of everything (on every monitor) while you keep working
underneath, and both can **remind you of things**: at the time you set, your
buddy comes to the middle of the main screen and tells you what to do.

Everything is drawn in code and every sound is synthesized — there are no image
or audio assets. (Iron Man here is an original fan-made drawing for personal
use; the character belongs to Marvel. If you publish this widely, rename him.)

## 🐱 The cat

| | |
|---|---|
| **Pick it up** | Drag the cat: it's carried by the scruff like a mother cat carries a kitten, swings as you move, and lands on its feet where you let go. Shake it and it gets dizzy. |
| **Hunger** | Feed fish, kibble, chicken or milk, or a treat by hand. A hungry cat begs and gets thin; if it starves too long it becomes weak and **dies** — a ghost floats up and a R.I.P. tombstone appears. Lay flowers or adopt a new kitten. |
| **Poop** | It poops, kicks "litter" and runs off. *Clean up → Scoop poop* turns your cursor into a scoop — click each one to collect it. |
| **Sleep** | A sleepy cat shows a 🌙 bubble. *Sleep* places a bed; it circles twice and curls up. |
| **Mouse chase** | Your cursor becomes a toy mouse; the cat stalks, wiggles and pounces. |
| **Mischief** | Scratches the screen and drags pretend files around. Fix with the repair spray and *Tidy up files*. |
| **More** | Laser, yarn, box, catnip, brush, petting & purring, slow blinks, zoomies, moods and thought bubbles. |

## 🦾 Iron Man

| | |
|---|---|
| **On the ground** | He stands and walks (heavy metal steps) on the bottom of each screen. To go anywhere higher he has to **fly**: crouch, take off, hover, cruise in the classic flight pose, and finish with a superhero landing. |
| **Enemies** | Right-click → *Deploy enemy* drops a **flying drone**, **ground walker**, **tank**, **drone swarm** or a **heavy mech boss** exactly where you clicked. Ground units fall to the floor; flyers swarm around him. They shoot back (lasers, arcing shells, homing missiles, a charging beam). |
| **Weapons** | **Repulsor** palm blasts, **double hand blast** at close range, homing **micro-missiles** from the shoulders, the **unibeam** from the arc reactor (cuts through a whole line), and a punch when they get too close. He also dodges incoming fire. |
| **Attack here** | Right-click any spot → *Attack here* → fire that weapon at it. Click an enemy to lock it as the priority target. |
| **☢ Nuke** | Right-click → *Drop a nuke here* (or HQ → *Nuke*, per screen). An air-raid siren wails, a laser marks ground zero, and the bomb whistles down onto the floor of that screen. Then a white flash, a ground-burst fireball that climbs into a mushroom cloud with a condensation ring, and a shockwave that sweeps the **whole screen** — every enemy on it is destroyed — and rolls on into your other screens. Iron Man (and the Legion) race to the far side of another screen; when the wave catches them they're **thrown** through the air, tumble, crash and get back up. |
| **⚔ Army attack** | Right-click → *Army attack…* (or HQ → *Army attack*): choose where they come from (left, right, the sky or both sides) and how many: 10, 20, 35, 50, or the **epic** battles — **200** and **1000 (legendary)**. Heavy mechs march in with the later waves. A banner tracks how many are left. |
| **🦾 Iron Legion** | When an army arrives Iron Man calls in other suits — 2 for a small army, up to **7** for a big one — each in its own colors with a callsign (MK-XVII, MK-XL…). They fly in, take their own positions and fight alongside him; in an epic battle a destroyed suit is replaced. When the army is beaten they salute and fly home. You can also *Call / Dismiss the Legion* from the Suit menu. |
| **Power & armor** | Flying and weapons drain the arc reactor, standing on the floor recharges it, missiles reload over time. At zero armor the suit goes **offline**, falls and **reboots**. Menu → *Suit* → repair / recharge. |
| **More** | Patrols, fly-bys, area scans, **diagnostics** (your real CPU, memory, battery, uptime in a HUD card), thumbs-up, eight suit colors, random invasions (off by default), difficulty, stand-by mode. Drag him and let go — his thrusters catch him. |
| **HUD look** | His menu and the home window ("HQ") switch to a holographic HUD theme. |

## ⏰ Reminders

Home window → **Reminders**: pick a time and type what you need to do
(once, every day, weekdays or weekends), or use a quick 5/15/30/60-minute timer.
At that time your buddy comes to the **center of your main screen** — the cat
runs over and meows, Iron Man flies in and delivers a *mission briefing* — shows
the task and **reads it aloud**. Press **Done** or **Snooze** 5/15 min. A system
notification is sent too. Missed by a few minutes (computer asleep)? It still fires.

## Run it

Requires **Node.js 22+** (Electron 45's installer needs it).

```bash
cd desktop-cat
npm install
npm start
```

Find the app in the **menu-bar / system-tray** icon. Upgrading from "Desktop Cat"?
Your cat comes along automatically.

### macOS: right-click anywhere

macOS only lets apps see clicks outside their own windows with **Accessibility**
permission. Without it everything still works — right-click **the character**,
use the menu-bar icon, or press **⌘⌥⇧K** — but to right-click *anywhere*, open
the menu → **Enable right-click anywhere…** and switch on *Desktop Buddies* (or
*Electron* when running from source) in System Settings → Privacy & Security →
Accessibility. On Windows and Linux no permission is needed.

## Build installers

```bash
npm run dist:mac     # .dmg + .zip   (on a Mac)
npm run dist:win     # .exe installer + portable .exe (on Windows)
npm run dist:linux   # .AppImage + .deb (on Linux)
```

The GitHub Actions workflow (`.github/workflows/build.yml`) builds all three:
push a tag like `v2.0.0` or run it manually, then download the installers from
the run's *Artifacts*. Builds are unsigned (macOS: right-click → *Open* the first
time; Windows: SmartScreen may ask to confirm).

## Controls

| Do this | Cat | Iron Man |
|---|---|---|
| Right-click (anywhere / on it) | care menu | suit menu |
| ⌘⌥⇧K / Ctrl+Alt+Shift+K | menu at the cursor | menu at the cursor |
| Drag | carry by the scruff | carry him; he hovers when released |
| Click | boop | thumbs-up / quips |
| Hover | needs card | power / armor / missiles card |
| Stroke back & forth | petting, purring | — |
| Click an enemy | — | lock target |
| Esc (needs global hook) | put tool away | snooze a briefing |

## Platform notes

- **Linux:** needs a compositor for transparency (plain i3/openbox: run `picom`).
  The app runs through X11/XWayland (it relaunches itself with
  `--ozone-platform=x11` on Wayland); on a pure Wayland session cursor-following
  may be limited — an "on Xorg" session works best. The tray needs AppIndicator
  support (GNOME: the *AppIndicator* extension); launching the app again also
  brings a hidden buddy back.
- **Windows:** the overlay is 1px shorter than the screen so Windows doesn't treat it
  as a fullscreen app.

## How it works

```
src/main/main.js       Electron main: overlays per display, click-through, tray, menu, IPC,
                       character switching, reminders, saving (+ import from "Desktop Cat")
src/main/world.js      Cat simulation: needs, generator "tasks" brain, entities, tools
src/main/ironman.js    Hero simulation: flight physics, floor per screen, enemy AI,
                       projectiles, beams, damage, power, reboot, nuke, armies, Iron Legion
src/main/reminders.js  Reminder scheduling (once / daily / weekdays / weekends, snooze)
src/main/geometry.js   Multi-monitor union, clamping, routing across screen edges
src/main/sysinfo.js    CPU / memory / uptime for the hero's diagnostics
src/main/hook.js       Optional global mouse/keyboard hook (uiohook-napi, listen-only)
src/renderer/catArt.js    Procedural cat: skeleton, 27 blended poses, faces
src/renderer/ironArt.js   Procedural armored hero (21 poses, 2-bone IK), enemies, beams, explosions, nuke
src/renderer/overlay.js   Draws the world as depth-sorted sprites; briefing & diagnostics panels
src/renderer/ironScene.js Hero / enemy / projectile rendering
src/renderer/menu.js      Right-click menu for each character
src/renderer/sound.js     Synthesized sounds + text-to-speech for reminders
src/home/                 Home window (Cat Home / HQ), reminders editor
```

### Developing

- `npm test` — headless cat, multi-monitor and hero/combat/army/nuke/reminder tests
  (including a full 1000-unit battle).
- `dev/gallery.html` — every pose, face, prop, hero pose and enemy (serve the folder,
  e.g. `python3 -m http.server`, then open `/dev/gallery.html?mode=iron`).
- `npm run dev` with `CAT_CMD_FILE=/tmp/cmd.txt` drives the app from a file
  (`character {"name":"ironman"}`, `spawn {"kind":"boss","x":900,"y":400}`,
  `reminderAdd {"inMinutes":0,"text":"Test"}`, `capture {"dir":"/tmp"}` …) — see `devPoll`.
- `CAT_USER_DATA=/some/dir` uses a separate save; `DESKTOP_CAT_NO_HOOK=1` skips the global hook.

## Ideas for later

More characters, kitten → adult growth, sitting on top of windows, reacting to
typing, achievements, a boss-rush mode, buddies that meet each other, calendar import
for reminders.
