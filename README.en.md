# Jeju Olle Trail · 100K Guide (Jeju Island 제주올레)

> 🌐 Language: [中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)
>
> 📌 The data-acquisition backstory, trial-and-error records, and historical data snapshots live in **[CHANGELOG.md](CHANGELOG.md)** (Chinese). This document only covers how things work now.

## Overview

Turn Jeju Island's 27 Olle trails (올레길) into your own itinerary: automatically calculate distance, see whether you've pieced together a 100 km, and manage start/end points, roadside lodging, scenery, and a photo album.

Pure front-end. Data is saved in the local browser (localStorage + IndexedDB). Dependencies are managed with npm; end users use the static site produced by `npm run build`.

## Quick Start (Overview)

| Step | Command | Description |
| --- | --- | --- |
| 1 | `npm install` | Install dependencies |
| 2 | `npm run dev` | Local development, open http://127.0.0.1:5180 |
| 3 | `npm run build` | Produce `dist/`, the static site end users use |
| 4 | `npm run preview` | Verify the build locally |
| 5 | Deploy (optional) | Serve `dist/` from any static server / Dokploy subpath |

> Key: **Basemap data comes from OpenStreetMap — global coverage, no API key needed**. Jeju's streets, coastline, and terrain all render normally; when offline the map area is blank but core functions like distance tallying are unaffected. See §5.

## 1. What's preloaded

On first open, the **official 27 Olle trails** (source: jejuolle.org) are written automatically:

- **21 main routes + 6 branch routes** (1-1 Udo Island, 7-1, 10-1 Gapado, 14-1, 18-1 Sangchujado, 18-2 Hajuchado)
- Official distances are filled into "actual distance", so **distance uses official values**, not straight-line estimates
- Official difficulty Low / Medium / High mapped to 2 / 3 / 4 stars
- Main routes are 10.1–20.9 km each; **27 routes total 402.8 km** (`OLLE_TOTAL_KM` is derived from `SPECS`, not hard-coded — the homepage's "437km 27코스" is a marketing figure; both numbers are valid, don't reconcile one to the other)

| Data | Status |
| --- | --- |
| Route numbers, start/end names, official distance, official difficulty | Official website (jejuolle.org), directly usable |
| Route geometry (shape, start/end coordinates) | **Measured tracks for all 27 routes** — see below |
| Elevation & cumulative climb | Calculated from tracks or sampled along them — see below; **`06` / `07` have no elevation data, climb shows "—"** |
| Lodging | Preloaded with 239 places from OSM (matched to 12 routes), editable in `/admin` |
| Card cover | Scenic photo of the route area (Wikimedia Commons free license — run `scripts/fetch_photos.py` first); falls back to the official Route Map if you haven't |
| Sights, album | Preloaded empty, enter in `/admin` |

### How climb is calculated (important)

The preset routes' elevation series are fetched by `scripts/fetch_elevation.py` from opentopodata.org's public **SRTM 30m** dataset, landing in `src/lib/olleeElevation.ts` (bundled at build time, no network at runtime).

- **Non-loop routes**: uniform sampling along the "start → end" line (20–43 points each)
- **Loop routes** (Udo / Gapado / Sang/Hajuchado): circular sampling inferred from official distance
- Climb uses a **3m hysteresis threshold** on adjacent differences to suppress terrain-data jitter

⚠️ This is an **estimate, not official measured climb**: the real route winds along the coast and climbs small coastal hills that straight-line sampling can't capture, so actual climb is usually larger than shown. 27 routes total ~2230 m — fine for ranking "which is harder", but for pacing and resupply planning use real tracks (see next section; after import, climb auto-switches to track-based).

To refresh this data:

```bash
python3 scripts/fetch_elevation.py            # refetch all (has local cache, only fills missing)
python3 scripts/fetch_elevation.py --limit 2  # try 2 first to see effect
python3 scripts/fetch_elevation.py --force    # ignore cache, refetch all
```

Routes you create yourself have no sampled data; fill elevation per point in `/admin` "Waypoints"; **with fewer than 2 points having elevation, climb shows "—" not 0** (0 would falsely imply the route is flat).

### Real tracks & coordinate accuracy (as of 2026-10-01)

All **27 routes have measured tracks** (`public/tracks.json`, fetched at runtime — **not stored in localStorage**; replace the file to swap tracks).
Routes with a track are drawn as a **solid line** (white casing + green core); start/end snap to the track endpoints, and climb accumulates point by point along the track.

| Item | Status |
| --- | --- |
| Track source | OSM route relations / OSM standalone ways / full-course Olle GPX, compared per route number (`tracks/osm/*.geojson`) |
| Official ↔ track deviation | 15 routes within ±5%; **12 exceed it**, with `15` (+19.0%) and `08` (−11.9%) flagged ⛔ |
| Elevation source | 4 routes carry elevation in the track; 21 are sampled along the track from SRTM 30m; `06` / `07` have no elevation |
| Total climb | 25 routes have data, **5807 m** combined |

⚠️ **Second-hand geometry**: all of it comes from OSM / GPX, and **OSM does not follow official route changes**.
Distance shown in the UI always takes the official `SPECS` value, with "track measures X km" shown alongside for comparison,
so the deviations above never make the page contradict itself — but treat **climb and map shape for `15` and `08` with a grain of salt**.

> 📌 How the three sources are compared, which geometries were accepted or rejected per route, and historical deviation snapshots: see [CHANGELOG.md](CHANGELOG.md) (Chinese).

### How elevation & climb are calculated

Priority: **manual "actual climb"** > **elevation carried in the track** (`elevSource: track`) > **SRTM 30m sampling along the track**
> **preset approximation profile** (`src/lib/olleeElevation.ts`, also SRTM 30m, bundled at build time, no network at runtime)
> **manual waypoint elevations** > otherwise **"—"**.

- Accumulation uses a **3 m hysteresis threshold** on adjacent differences to suppress jitter in the terrain data.
- **Fewer than 2 points with elevation shows "—", not 0** (0 would falsely imply the route is flat) — that's the case for `06` / `07`.
- The preset profile samples straight lines between endpoints (or circles inferred from official distance for loops); real climb is usually larger. It is only a fallback when there is no track.

To refresh the data:

```bash
python3 scripts/check_official_consistency.py            # official vs actual geometry, per route (run after any change)
python3 scripts/fetch_elevation.py                       # refetch the approximate profile (cached, fills missing only)
python3 scripts/fetch_elevation.py --limit 2             # try 2 first
python3 scripts/fetch_elevation.py --force               # ignore cache
```

### Re-importing / adding tracks

Run regressions first if you changed script logic (both offline):

```bash
python3 scripts/selftest_fetch_osm.py        # stitching & verdicts
python3 scripts/selftest_import_tracks.py    # import & direction correction
```

Then the real flow:

```bash
# 1) fetch real geometry — feed all three sources, the script compares per route
python3 scripts/fetch_olle_osm.py --gpx ~/Downloads/olle-all.gpx --dry   # report only, writes nothing
python3 scripts/fetch_olle_osm.py --gpx ~/Downloads/olle-all.gpx

# 2) convert to the front-end format, optionally backfill elevation online
python3 scripts/import_tracks.py --src tracks/osm --elevation
```

Overpass often returns 504/429, so three escape hatches exist:

| Flag | Purpose |
| --- | --- |
| `--cache-dir scripts/.cache/osm` | responses cached by query hash; later runs read from disk. **Always on while tuning** |
| `--offline` | read cache only, never hit the network; reports whichever routes are missing |
| `--reuse-dir tracks/osm` | read relation geometry from existing `olle-*.geojson`, skip the relations query |

> ⚠️ `--reuse-dir` **only reuses files whose origin is an OSM relation** (check the `geomSource` field; `both-*` is allowed).
> Without that guard, last round's GPX output gets reused as relation geometry and the source labels blur.

GPX / KML / GeoJSON from elsewhere works the same — drop files in a directory (filenames containing `1` / `01` / `10-1` are recognised):

```bash
python3 scripts/import_tracks.py --src ~/tracks --dry        # check recognition first
python3 scripts/import_tracks.py --src ~/tracks --elevation  # import
python3 scripts/import_tracks.py --src ~/tracks --strict     # exit if any file is unrecognised
```

- Filename without a recognisable code → `--map filename=code`; OSM A/B variants → `--alias 03-A=03`.
- Direction is auto-corrected from "adjacent courses share endpoints"; override with `--reverse 01` / `--no-orient`.
  **Auto-correction only works when the chain is complete** — a gap in the numbering makes it miss that pair, so always read the flip line in the output.
- **Tracks with gaps are handled as segments**: drawn per segment with no connecting line; distance sums the segments, climb accumulates per segment.
- Simplification defaults to 8 m tolerance / 420 points cap (Douglas–Peucker, budget shared across all segments).
- Deviation >25% from official distance raises a warning (usually a misread code or an included shuttle segment) — verify before writing.

## 2. Features

| Module | Page | Capabilities |
| --- | --- | --- |
| Route list | `/` | 27 routes listed by number; search (name/region/tag, supports "올레 07"/"Seogwipo"), filter by type, sort by number/distance/updated/name; top trip basket toggles directly; one-click add to basket from card |
| Route detail | `/routes/:id` | Map shows start/end, elevation profile, roadside lodging (auto "N km along route / N km from route"), roadside scenery, photo lightbox |
| Trip basket | `/plan` | Add routes (each counted once; added button disabled), custom target distance (quick 100 or 437 full), live cumulative +达标 check; suggests fill routes by gap; **default order by adding sequence** (switchable to "by distance"), Markdown copy follows current order; per-route "done" checkbox shows progress (X/Y + distance), supports "unfinished only" |
| Pre-trip | `/prep` | Jeju checklist (5 groups 35 items, checkable, manually skip/restore, unfinished-only, add own; skipped items gathered under "my own items" for review/restore) + **hiking gear / women's / men's / DJI / camera / drone preset lists** (gear 10, women's/men's 11/10 each; add per-item or whole list, brings source tag, removable anytime) + transport/lodging/food cheat-sheet (T-money card/riding notes, nav app comparison, taxi payment) + rough budget |
| Asset management | `/admin` | Route CRUD (incl. number); waypoints support map point-pick + reorder; lodging, sights (multi-image), album (local upload auto-compress or external link); JSON import/export |
| Settings | `/settings` | Basemap style, clear data |

> Footer credit: basemap OpenStreetMap, data source **jejuolletrailguide.net** (Jeju Olle Trail official English guide); also listed in footer "friend links" (external links always new tab + `rel="noopener noreferrer"`). Friend links live in `src/App.tsx`'s `FRIEND_LINKS`; add one line to add.

Typical 100K usage: main routes average 15–20 km, **pick ~6 routes to reach 100 km**; to walk the whole island set target to 437.

## 3. Where data is stored

| Content | Location |
| --- | --- |
| Routes / trip basket / settings | `localStorage` (key prefix `jejuolle100k.`) |
| Pre-trip checklist checks & custom items | `localStorage`'s `jejuolle100k.checklist` |
| Locally uploaded images | `IndexedDB` (db `jejuolle100k` → store `images`), compressed to max edge 1600px, JPEG 0.82 on upload |

Data is not uploaded to any server. Before switching devices or clearing the browser, go to `/admin` top "Export JSON" to back up; after switching, "Import JSON" to restore (merge or replace optional).

## 4. How distance is calculated

| Scenario | Value |
| --- | --- |
| Preset Olle routes | Official distance (`manualDistanceKm`) first, no estimate |
| Routes you create, not manually filled | Adjacent waypoint straight-line sum × 1.2 (detour factor) |
| Climb | Priority explained in §1 "How elevation & climb are calculated" (track elevation > sampled along track > preset profile > manual waypoint elevation > manual climb highest; "—" if none) |

Trip basket: each route counted once, sum of all distances compared to target, directly gives "reached / N km short", and suggests fillable routes by gap size.

## 5. Map basemap notes

The basemap is rendered with **Leaflet**, data from **OpenStreetMap** (tiles served by OpenStreetMap / OpenTopoMap public services), global coverage, Jeju's streets/coastline/terrain all render normally, **no API key needed, no configuration needed**.

| Basemap style | Tile source | Traits |
| --- | --- | --- |
| Standard map (default) | OpenStreetMap `tile.openstreetmap.org` | Most complete road/POI/name elements |
| Terrain map | OpenTopoMap `tile.opentopomap.org` | Contour + hillshade, good for judging hiking / off-road climb |

Style switches with one click in "Settings", takes effect immediately, choice stored locally.

- Tiles need network to load; **offline the map area is blank**, other functions unaffected.
- **Two line types** (`src/lib/geo.ts`'s `mapLineSet()` → `MapLine.approx`):
  **Solid line (white border + green core)** = measured track in `public/tracks.json` (all 27 main and branch routes);
  **gray-green dashed** = no measured track (usually routes you created yourself), just connecting waypoints as a
  **schematic line** — don't treat it as the real route.
  Detail page and trip basket page both point this out in their descriptions.
- In extreme cases Leaflet init failure auto-downgrades to **offline schematic** (SVG projection), still clickable to reverse geocode.
- Coordinates unified as **WGS-84** (consistent with OSM). Jeju is outside China; the GCJ-02 offset algorithm doesn't apply abroad, so historical coordinates are equivalent to WGS-84, switching basemaps won't cause position shift.

> ⚠️ Compliance note: OpenStreetMap / OpenTopoMap are foreign tile sources, **not applicable to surveying/mapping map products aimed at mainland China**. This project is positioned as a personal self-use tool for Jeju Island (overseas) hiking guides, foreign tile sources are fine; if later published to mainland users as a surveying product, you must switch to a basemap service with surveying qualifications that covers the target region.

## 6. Route illustrations & covers

Card covers use **official Route Map** (one page per route), album uses **Wikimedia Commons freely-licensed photos**. Both assets live in `public/photos/`, read by the frontend at startup by route number (not in localStorage, replace files to swap).

### 6.1 Official Route Map → detail-page album (fallback for the card cover)

Split Jeju Olle Foundation's official "Route Map" PDF by route into images, one page per route:

```bash
# default reads ~/Downloads/171011_jeju-olle-route-map.pdf
python3 scripts/split_route_map.py
python3 scripts/split_route_map.py --pdf /path/to/route-map.pdf
python3 scripts/split_route_map.py --limit 2      # cut 2 first to see effect
```

| Output | Description |
| --- | --- |
| `public/photos/maps/olle-<number>.webp` | **Detail page original**: one full page per route (1432×1012, ~100KB each, 26 images total 2.5MB), for album and lightbox |
| `public/photos/maps/cover/olle-<number>.webp` | **Card cover (compressed)**: 760×537, ~25KB each, 26 images total 0.65MB |
| `public/photos/maps.json` | number → `{ file: original, cover: cover }`, frontend reads it to set `cover` and add original to album (clickable for full size) |

**Why two sizes from one image**: card cover renders only ~300–400px wide in the list (`.cards` is `minmax(min(300px,100%),1fr)`), cramming the 1432px original is wasteful — 26 covers on homepage would pull 2.5MB. Separate compressed cover drops first screen to 0.65MB, while detail/lightbox still shows 1432px original, zooming to read place names unaffected.

Compression is **local** (Pillow resize + WebP quality drop, `--cover-width` / `--cover-quality` adjustable), same class as TinyPNG / tinyimg online services, but no API key, no uploading images to third parties, reproducible. You can switch to online services too, just overwrite the compressed result to the same-named file in `maps/cover/`.

Conventions:

- **Do not crop**. Official page is 842×596 landscape, map fills the whole page; cropping 30% top/bottom cuts into the route body (01's south end, 10-1's Jeju-mainland side get cut). Cover side's `.route-cover` uses `aspect-ratio: 842 / 596` to reserve space by page ratio, zero crop.
- **Page number ↔ route number must be verified**. `PAGE_CODES` in the script is organized by the bold route number printed at each page's bottom-right (PDF page 1 is cover, pages 2–27 are routes). When switching to a new PDF version, re-verify this table, otherwise route numbers get mismatched.
- This 2017.10 version **has no Route 18-2 (Hajuchado) page**, so 18-2 uses "no illustration" placeholder.
- Cover priority: **admin-set cover > official route map > Commons photo**. To use your own photo, upload one in `/admin` "Basic Info".

> ⚠️ Official route map copyright belongs to **© Jeju Olle Foundation**, PDF inner pages explicitly say "no permission for commercial reproduction, copying and distribution". This project is a personal self-use guide tool, non-commercial, and album/lightbox both show the credited `credit`; **do not use commercially**.

### 6.2 Card covers (scenic photos, Wikimedia Commons free license)

Images from Xiaohongshu etc. have copyright and are forbidden to scrape, **do not** bulk-download them into the project. This project uses Wikimedia Commons freely-licensed works (CC0 / CC-BY / public domain) instead.

```bash
# download illustrations for 27 routes (needs network access to commons.wikimedia.org)
python3 scripts/fetch_photos.py            # full
python3 scripts/fetch_photos.py --limit 2  # try 2 first
python3 scripts/fetch_photos.py --dry      # search only, no download
```

The script outputs:

| File | Role |
| --- | --- |
| `public/photos/olle-<number>.jpg` | illustration (max edge 1600px) |
| `public/photos/manifest.json` | number → image mapping, read at frontend startup and bound to corresponding route (not in localStorage, replace file to swap) |
| `public/photos/CREDITS.md` | attribution list (author / license / source page), satisfies CC-BY attribution requirement, distribute with the project |

When the script isn't run the album is empty, interface shows "no image" placeholder, no error.

> Note: photos are illustrative photos of "the place the route passes through", **not official route photography**, and **not measured tracks**. To use as guide basis, please rely on official materials and your own photos.
> If a photo is unsuitable: delete the corresponding file under `public/photos/` and the entry in `manifest.json`.

## 7. Pre-trip page data boundaries

`/prep` content references the Olle trail official site (jejuolle.org), Korea Tourism Organization public materials, and public travelogues, compiled 2026-09, written in `src/lib/prep.ts`.

- **Policy items marked "verify before departure"** (red small tag): visa waiver caliber, whether K-ETA is required, IDP car rental, emergency phone may change, confirm again before departure.
- **The Olle passport is NOT a verify item**: it's a booklet bought on the ground after arriving in Jeju (tourist centers / shops near trail starts, about ₩20,000, bring cash); the price is whatever it is on site, no need to check before departure.
- **Prices are only common ranges**, for budget estimation, subject to booking platform and store real-time info.
- **No specific store or hotel names** — unverified names aren't invented, check reviews on Kakao Maps / Naver Maps yourself.
- **Transit & payment operation details** (T-money card fee and transfer caliber, iOS card limit, STOP bell and skip-stop, Uber face-to-face pay, etc.) come from hands-on experience and public travelogues, not official terms, change faster, already marked red in page with reference links.
- The car rental item is a key reminder: Korea requires short-stay visitors to hold a 1949 Geneva Convention paper IDP, and **mainland China driver's licenses are not within the scope of issuable IDP**, most rental companies won't take the order in practice. For self-driving please confirm in writing with the rental company first.
- **Women's / men's preset lists** are experiential advice on "what to bring, why", **no policy or price assertions**; hard rules like carry-on liquid capacity, security (nail clippers suggest checked baggage) are written in `note` as prompts per conventional caliber, not promises. The two lists' copy is deliberately not overlapping with the official 43 items — otherwise the de-dup logic judges them as "already in list", equaling wasted writing.

### Checklist check / skip state machine

`jejuolle100k.checklist` (see `ChecklistState` in `src/lib/storage.ts`) manages four mutually-exclusive id sets:

| State | Field | Meaning |
| --- | --- | --- |
| Ready | `checked` | checked items, counted in progress |
| Skipped | `skipped` | manually skipped items, **not counted in progress denominator, nor unfinished**, still shown normally (grayed + "skipped" tag, one-click "restore") |
| Custom | `custom` | self-added items (`PrepItem[]`) |
| Preset added | `extras` | items picked from "women's/men's commonly-used list" (`ChecklistExtra[]`, one more `from` than `PrepItem` to remember source) |

- Checking an item auto-removes it from `skipped` (mutually exclusive); skipping an item auto-unchecks it.
- "Unfinished only" hides both checked and skipped; normal mode skipped items still visible, for easy restore.
- "Select all in group" only acts on unskipped items, won't re-check skipped ones.
- Progress bar and each group's `done/total` only count "unskipped" items.

### How preset lists (women's / men's) enter the master list

Data source is `PREP_PRESETS` in `src/lib/prep.ts` (two sets with independent ids: `preset.f.*` / `preset.m.*`).
They are **not the default list**, just a candidate pool: when `extras` is empty the page shows nothing extra, only after the user picks some does the "preset list added" group appear.

| Action | Behavior |
| --- | --- |
| Single "add" / "remove" | write / delete one entry in `extras`, equivalent to toggle, no second confirmation |
| "Add all (N)" | `ids` omitted → whole merged in; N on button is **de-duped real new count** |
| "Remove all" | whole removed from master list (goes through Confirm, since it clears these items' check/skip states) |
| "Reset list" | `checked / skipped / custom / extras` all cleared |

De-dup caliber (`addPresetItems`): **judge "added this" by id, judge "is there already the same thing in list" by `normItemText(text)`** (ignore all whitespace and case). Matched entries aren't written again, selector shows "already in list" and removes button. When the same item already exists in the official group it won't be added again — so the two lists' copy is deliberately not overlapping with the official 43 items.

⚠️ De-dup must be calculated by `prev` inside `setChecklist(prev => ...)` updater, can't judge by render-phase `checklist`: clicking "add" repeatedly the render-phase snapshot is old, writes the same item repeatedly. Likewise, updater returning no new value returns `prev` original object (React skips re-render, also doesn't waste a localStorage write).

## 8. No white screen on error

Two-layer `ErrorBoundary` (`src/components/ErrorBoundary.tsx`):

| Layer | Location | Catches |
| --- | --- | --- |
| Whole site | `main.tsx` wraps `<App />` | even Router / Provider itself crashing has a page |
| Page | `App.tsx` content area, `key` bound to pathname | single page crash still keeps top nav, switch pages to continue; route change auto-resets error state |

Error page offers: retry / back to home / copy error info / expand component stack / **clear local data and reload** (last resort when bad records in data, goes through self-made Modal second confirmation).

⚠️ It only catches **render-phase** errors. Event callbacks, `setTimeout`, request callbacks' async errors React won't bubble up (manifests as "click does nothing", no white screen).
`DataProvider`'s data loading runs in `requestAnimationFrame`, exceptions also can't bubble to React — so there it's separately converted to render-phase throw to the boundary, avoiding stuck on skeleton screen fake-death.

## 9. Deployment (Docker + nginx + Dokploy subpath)

The project is a **pure static front-end** (`HashRouter` + `base: './'`), no backend, packaged as nginx static image per `asset-system-frontend` paradigm, mounted under `/jeju/` subpath, distributed by Dokploy's Traefik by PathPrefix.

### Key files

| File | Role |
| --- | --- |
| `Dockerfile` | multi-stage build: node install deps + `npm run build`, product `dist/` copied to nginx's `/usr/share/nginx/html/jeju` |
| `nginx.conf.template` | nginx:alpine renders `templates/*.template` via envsubst into `conf.d/default.conf` at startup; this template only does `/jeju` → `/jeju/` redirect + static hosting + SPA fallback |
| `.dockerignore` | exclude node_modules / dist / .git / local script cache, shrink build context |
| `.npmrc` | use npmmirror to speed up in-container `npm ci` |

> Because it's `HashRouter` + `base: './'`, `dist/` resources use relative paths, no need to change `vite.config.ts` under `/jeju/`, no history route rewrite needed.

### Build and self-test image locally

```bash
docker build -t jeju-olle-100k .
docker run --rm -p 8080:80 jeju-olle-100k
# open http://localhost:8080/jeju/ in browser to verify
```

### Push to Dokploy

1. Dokploy create **Application**, source connect GitHub public repo `tanabalu/jeju-olle-100k` (main branch).
2. Build method select **Dockerfile** (multi-stage already written, no extra params).
3. Port: container exposes `80`, Dokploy internal port fill `80`.
4. **Traefik route rule** (PathPrefix): `Path(\`/jeju\`) || PathPrefix(\`/jeju/\`)`, which matches the `/jeju` path segment only and keeps a same-host Pages path such as `/jeju-olle-100k/` out of Dokploy.
5. After deploy access `https://your-domain/jeju/` (replace "your-domain" with the domain actually hosting this subpath).

> When switching subpath change two places: `Dockerfile`'s `COPY ... /usr/share/nginx/html/<new-path>` and `/jeju`, `/jeju/`, `/jeju/index.html` in `nginx.conf.template`.

## 10. Directory structure

```
src/
  types.ts               data model (Route with code route number)
  lib/geo.ts             Haversine distance, climb (with noise threshold), POI projection to route
  lib/olleeElevation.ts  27 routes' terrain sampling series (script-generated, do not hand-edit)
  lib/storage.ts         localStorage repository + import/export
  lib/imageStore.ts      IndexedDB image storage and compression
  lib/seed.ts            27 Olle trails preset data
  lib/prep.ts            pre-trip checklist & transport/lodging/food cheat-sheet data (policy items marked verify)
  store/DataContext.tsx  global data + assets (official route map / photos / real tracks) overlay + checklist state
  hooks/useActivePlan.ts trip basket operations
  components/            RouteMap / ElevationChart / Modal / Feedback / Skeleton / ErrorBoundary ...
  pages/                 Routes / RouteDetail / Plan / Prep / Admin / Settings
  pages/admin/           Basic Info / Waypoints / Lodging / Sights / Album five editors
public/photos/           official route map (maps/ + maps/cover/ + maps.json) and album illustrations, attribution list
public/tracks.json       real tracks (import_tracks.py generated, fetched at runtime)
scripts/fetch_photos.py  Commons free-license image scrape script
scripts/split_route_map.py  official Route Map PDF split by route into card cover (compressed) + detail original
scripts/fetch_elevation.py  SRTM 30m elevation scrape script (generates olleeElevation.ts)
scripts/fetch_olle_osm.py    from OSM (relation + loose way) and whole GPX **three-source comparison**, grab each route's real direction (→ tracks/osm/*.geojson)
scripts/selftest_fetch_osm.py  stitcher regression self-test (no network, 52 assertions, run this first after changing stitcher logic)
scripts/import_tracks.py    GPX / KML / GeoJSON track import (recognize number, correct direction, simplify, calculate distance/climb → tracks.json)
scripts/selftest_import_tracks.py  importer regression self-test (no network, run this first after changing direction correction/import logic)
scripts/check_official_consistency.py  per-route reconciliation "seed.ts official caliber ↔ tracks.json actual geometry" (must run after changing SPECS or re-import)
scripts/check-elevation.ts  verify tracks.json elevation and climb self-consistency
```

## 11. Known boundaries

- **Tracks are second-hand geometry**: all 27 come from OSM / GPX, and **OSM does not follow official route changes**.
  Distance shown in the UI always takes the official `SPECS` value, with "track measures X km" alongside.
  12 routes deviate more than ±5%, of which **`15` (+19.0%) and `08` (−11.9%) exceed ±10%** — treat their
  **climb figures and map shape with a grain of salt**; the other 10 (`01-1 / 03 / 05 / 06 / 07 / 13 / 14 / 17 / 18 / 21`) land between 5% and 10%.
- **`06` / `07` lack elevation data**: no elevation in the track and none backfilled, so climb shows "—"
  (showing 0 would falsely imply the route is flat).
- **Official marketing figure 437km vs per-route sum 402.8km**: both are valid, the ~34km gap is unexplained
  (official probably counts connecting segments in 437). The target distance uses the derived **402.8**;
  **437 is only shown as the "full island" quick preset**.
- **Routes you create yourself have no track**: drawn as a **gray-green dashed line** (`mapLineSet()`'s `approx: true`),
  just connecting your waypoints — correct the geometry in the admin panel, or import your own GPX.
- **Lodging has no ratings or prices**: OSM doesn't provide them, so the page omits what's missing instead of inventing it.
- **Sights / album** are still preloaded empty — enter them per itinerary (or import JSON in batch).
- Tiles need network; offline the map area is blank, downgrading to the SVG offline schematic in extreme cases.
