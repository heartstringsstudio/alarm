# Daily Verse Alarm

An installable phone app (PWA): a gentle chime, then the day's verse read aloud.
Verses come from **monthly verse packs** — add a folder, push, and every phone
picks it up the next time the app opens.

## Install on a phone
Open the app's web address (e.g. `https://heartstringsstudio.github.io/alarm/`), then:
- **iPhone (Safari):** Share ⬆︎ → **Add to Home Screen**
- **Android (Chrome):** tap **Install app** in the banner (or ⋮ → **Install app**)

It then opens full-screen from its own icon and works offline.

### How the alarm rings
Phones don't let web apps make sound once they're closed or locked. So at bedtime:
plug in, volume up, open the app, tap **🌙 Start bedside mode**. The screen dims to a
quiet clock and stays awake; the chime and verse play on time. (If a phone still
locks itself, set Auto-Lock to *Never* for the night.)

## Monthly update (≈15 minutes)
1. Copy `packs/_template/` to a new folder, e.g. `packs/2027-01-january/`.
2. Edit `pack.json` in that folder:
   - `id` = the folder name. `start` = first morning (`2027-01-02` — the day after the last pack ends).
   - `verses` = one entry per morning, in date order: `t` text, `r` reference, `k` search words.
   - Headline, lead, milestones, captions — whatever fits the month.
3. Add images to `img/` (`hero.webp`, `photo.webp`, `side.webp`, ~1440px wide).
4. Add narration to `audio/`: `verse-01.mp3`, `verse-02.mp3`, … matching verse order.
   Missing files fall back to the phone's built-in voice, so the alarm never goes silent.
5. Add the pack to `packs/index.json`:
   ```json
   { "id": "2027-01-january", "start": "2027-01-02", "days": 30 }
   ```
6. Check it: `node tools/check-packs.mjs` (also runs automatically before publishing).
7. Commit and push to `main`. Done — phones get it on next open.

Rules: always a **new folder** per month (never overwrite old file names — phones cache
them), and don't overlap dates. If a new pack is late, the newest pack repeats from the top.

## Files
| Path | What it is |
|---|---|
| `index.html`, `app.css`, `app.js` | The app |
| `sw.js` | Offline support. Bump `VERSION` when you change the app files (not needed for packs). |
| `manifest.webmanifest`, `icons/` | Home-screen name and icon |
| `sounds/` | Wake-up chime and bells |
| `packs/` | Verse packs + `index.json` |
| `tools/check-packs.mjs` | Pack checker |

## Publishing (one-time)
Repo **Settings → Pages → Source: GitHub Actions**. Every push to `main` then checks
the packs and publishes the app. (GitHub Pages on a free plan needs the repo to be public.)

## Later: a true store app
To ring with the phone locked, wrap this same app with Capacitor and schedule local
notifications (Android can ring like a real alarm; iPhone allows a ≤30-second
notification sound, then tap to hear the verse). Needs an Apple Developer ($99/yr)
and Google Play ($25 once) account.
