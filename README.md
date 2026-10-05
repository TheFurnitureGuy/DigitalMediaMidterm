# PS2-Inspired Photo Lab

A one-page website for the Digital Media midterm. Topic: Option B, Digital Color Systems & Quantization.

You upload a photo or choose a sample, give it a PS2-inspired look, and compare it with the original. The page explains how RGB values, palette reduction and dithering change the image. Everything runs in the browser. There is no server, account or AI service.

## Run it locally

The page has to be served over HTTP, because the image library can't load files from a `file://` page.

```
python3 -m http.server
```

Then open http://localhost:8000.

## Folder layout

```
index.html        the page
style.css         all styles
assets/js/        page scripts
assets/js/vendor/ third-party libraries
assets/fonts/     Inter web font
assets/images/    sample photos and thumbnails
assets/audio/     recorded explanation
assets/video/     required by the assignment, currently empty
docs/             audio script (not deployed)
```

## Third-party files

| File | Source | Version | License |
| --- | --- | --- | --- |
| `assets/js/vendor/canvas-plus.js` | github.com/jhuckaby/canvas-plus (npm: pixl-canvas-plus) | commit e96e76eafd189f5413bfc856fa001702f843f86c | MIT |
| `assets/js/vendor/pixi.min.js` | PixiJS, pixijs.com | 8.22.0 | MIT |
| `assets/js/vendor/pixi-filters.js` | github.com/pixijs/filters | 6.1.5 | MIT |
| Icons inline in `index.html` | Lucide (lucide.dev, npm: lucide-static); license in `assets/icons/LUCIDE-LICENSE.txt` | 1.52.0 | ISC |
| `assets/fonts/inter-latin-wght-normal.woff2` | Inter by Rasmus Andersson, via @fontsource-variable/inter | 5.3.0 | SIL OFL 1.1 |

Each license file sits next to its library or font.

## Photo credits

Both sample photos come from Pexels and are used under the Pexels license.

| Photo | Photographer | Source |
| --- | --- | --- |
| Sample photo 1: sunset over an open field | Guilherme Stecanella | https://www.pexels.com/photo/landscape-photography-of-an-open-field-under-the-orange-sky-11056055/ |
| Sample photo 2: rock formations in a desert | Radis B | https://www.pexels.com/photo/mountains-rocks-hills-rock-26311729/ |

## Text sources

The transcript's facts about PS2 dithering come from these articles.

| Article | Author | Source |
| --- | --- | --- |
| PlayStation 2 Architecture | Rodrigo Copetti | https://www.copetti.org/writings/consoles/playstation-2/ |
| PlayStation2 and the CRT TV | Libretro | https://www.libretro.com/?p=50686 |
| Here's why retro games look better on old CRT TVs | Igor Bonifacic, Engadget | https://engadget.com/2236809/why-retro-games-look-better-old-crt-tv |

## Deployment

Vercel deploys the repo root as a static site. There is no build step. `.vercelignore` keeps `CLAUDE.md`, `README.md` and `docs/` off the live site.
