<p align="center">
  <img src="assets/banner.svg" alt="Cephalon Merlin – Warframe companion" width="100%">
</p>

<p align="center">
  <a href="https://github.com/TvMerlinTv/Cephalon-Merlin/releases/latest"><img alt="Latest version" src="https://img.shields.io/github/v/release/TvMerlinTv/Cephalon-Merlin?label=version&color=8b6dff&style=flat-square"></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0f1219?style=flat-square&logo=windows">
  <img alt="Portable" src="https://img.shields.io/badge/no%20install-portable%20.exe-1e4d36?style=flat-square">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-8d96ad?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/TvMerlinTv/Cephalon-Merlin/releases/latest/download/Cephalon.Merlin.exe"><b>⬇&nbsp; Download Cephalon Merlin</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/TvMerlinTv/Cephalon-Merlin/releases">All versions</a>
  &nbsp;·&nbsp;
  <a href="#build-from-source">Source code</a>
</p>

---

**Cephalon Merlin** is a free companion app for [Warframe](https://www.warframe.com) on PC.
One click reads your inventory from the running game – then you see what you still need to master,
which builds the community plays, which relics are worth opening, what your items sell for on
warframe.market and when the next cycle changes. While you play, an overlay shows the rewards after
fissure missions together with their platinum and ducat value.

## ✨ Features

| | Section | What it does |
|:-:|---|---|
| <img src="assets/icons/foundry.svg" width="20"> | **Foundry** | Every frame, weapon and companion with its components – see at a glance what you own, what's missing and what's tradeable. Shows what's currently building with a countdown and notifies you when it's done. |
| <img src="assets/icons/mastery.svg" width="20"> | **Mastery Helper** | A **roadmap to your next Mastery Rank**: how much XP you still need, which items get you there fastest (starting with what you already own) and when it's time for your rank test. Plus a to-do list that shows which relics drop the parts you're missing. |
| <img src="assets/icons/inventory.svg" width="20"> | **Inventory** | All your tradeable items – prime parts, mods, relics, arcanes – with live platinum prices, ducat value and the total worth of your account. Click an item to sell it: copy a ready-made WTS message or open it on warframe.market. |
| <img src="assets/icons/relics.svg" width="20"> | **Relic Planner** | Expected platinum and ducats per opening for every relic you own, by refinement and squad size – so you know which ones are worth cracking. |
| <img src="assets/icons/builds.svg" width="20"> | **Builds** | The most popular builds from overframe.gg with full mod layout, guide and mod prices. Save favorites and finish builds with a checklist. |
| <img src="assets/icons/rivens.svg" width="20"> | **Rivens** | Your rivens with stats at rank 8, disposition, roll luck, kuva spent and what similar rivens sell for. |
| <img src="assets/icons/market.svg" width="20"> | **Warframe Market** | Live buy and sell offers from players who are online right now, split by mod rank – copy the whisper message with one click. |
| <img src="assets/icons/trade.svg" width="20"> | **Trading** | Finds your spare prime parts and duplicates: what's worth selling for platinum (with ready-made chat messages) and what to trade to Baro Ki'Teer for ducats. Set **price alerts** and get notified when someone sells an item below your price – or wants to buy it above it. |
| <img src="assets/icons/stats.svg" width="20"> | **Statistics** | Charts of your platinum, credits, endo, ducats, kuva and more over time, plus a log of every fissure reward with average platinum per run. |
| <img src="assets/icons/timer.svg" width="20"> | **Timers** | Day/night cycles, void fissures, void storms and Baro Ki'Teer – live, with optional Windows notifications. Plus today's sortie, the weekly archon hunt and nightwave challenges to tick off. |
| <img src="assets/icons/overlay.svg" width="20"> | **In-game overlay** | After a fissure mission it shows the four rewards with platinum and ducat value right inside the game, and gives recommendations in the relic selection. |

The app is available in **English** and **German**.

## 🚀 Getting started

1. **[Download Cephalon Merlin.exe](https://github.com/TvMerlinTv/Cephalon-Merlin/releases/latest/download/Cephalon.Merlin.exe)** and put it anywhere, e.g. on your desktop – no installation needed.
2. Start Warframe and log in.
3. In Cephalon Merlin, click **“Sync with game”** in the top left.
4. For the overlay, set Warframe to **“Borderless Fullscreen”** (Options → Display).

> [!NOTE]
> The .exe is not code-signed, so Windows SmartScreen may warn you on first launch:
> click **“More info” → “Run anyway”**.

<a id="build-from-source"></a>

## 🛠️ Build from source

Cephalon Merlin is open source (MIT). It is an Electron 33 + React 18 + Vite 5 app.
You need [Node.js](https://nodejs.org) 20 or newer and Windows (the game sync and the overlay use Windows APIs).

```bash
git clone https://github.com/TvMerlinTv/Cephalon-Merlin.git
cd Cephalon-Merlin
npm install
npm run dev      # Electron app with hot reload
npm run web      # UI only, in the browser (http://127.0.0.1:5173)
npm run dist     # portable .exe in release/
```

Optional: `node build/make-overframe-mods.cjs` generates `src/lib/overframeMods.json`, the mapping of
Overframe mod IDs that the Builds page needs to show mod loadouts. It is read from overframe.gg's website
and therefore not part of this repository; without it the app works, builds just show no mods.

| Folder | Content |
| --- | --- |
| `electron/` | Main process: game sync, overlay + OCR, world state, auto-sync, updater, settings |
| `src/` | React UI (pages, components, `lib/` for data and helpers) |
| `build/` | Scripts: icon, riven/Overframe data, preview, release |
| `github/` | Source of this page |

Pull requests and issues are welcome.

## ❓ FAQ

<details>
<summary><b>Syncing with the game doesn't work</b></summary>

Warframe has to be running and you have to be logged in. If it still fails, enter a loading screen
once (e.g. start a mission or go to the dojo) and sync again. If Warframe runs as administrator,
Cephalon Merlin has to as well.
</details>

<details>
<summary><b>The overlay doesn't show up in the game</b></summary>

Set Warframe to “Borderless Fullscreen”. Windows can't draw windows on top of exclusive fullscreen.
Also check Settings → Overlays to make sure the overlay is turned on.
</details>

<details>
<summary><b>How do I get updates?</b></summary>

Automatically: Cephalon Merlin checks for a new version on start and every few hours – or right
away via Help / Info → “Check for updates”. When one is available, “Update x.y.z” appears in the
title bar; one click on “Update now” downloads it and restarts the app. Your settings and data stay
as they are.
</details>

<details>
<summary><b>What does Cephalon Merlin read from the game?</b></summary>

Cephalon Merlin only reads and never changes anything in the game. To get your inventory it reads
the session token from the running game and uses it to load your inventory from Digital Extremes
once – the same request the game makes itself. The token is never saved, shown or shared. The
overlay reads the screen with text recognition and never clicks anything in the game.

Reading game data is not officially approved by Digital Extremes, and no third-party tool is
guaranteed to be ban-safe. If in doubt, check DE's terms of service.
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

Everything stays on your PC in `%APPDATA%\Cephalon Merlin` (button “Open data folder” under
Help / Info). Deleting that folder resets Cephalon Merlin.
</details>

## 🙏 Data sources

[warframe.market](https://warframe.market) (prices, riven auctions) ·
[overframe.gg](https://overframe.gg) (builds) ·
[warframestat.us](https://hub.warframestat.us) (world state, set prices) ·
[WFCD/warframe-items](https://github.com/WFCD/warframe-items) (item database, drops) ·
[WFCD/warframe-worldstate-data](https://github.com/WFCD/warframe-worldstate-data) ·
[warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus) (riven data) ·
[Warframe Wiki](https://wiki.warframe.com)

---

<sub>Released under the [MIT License](LICENSE). Cephalon Merlin is a fan project and is not affiliated with Digital Extremes. Warframe and all
related names and images are property of Digital Extremes Ltd.</sub>
