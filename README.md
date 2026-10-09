# Home Assistant Dashboard Extractor

This repository contains the `ha_extractor` Home Assistant app.

A Home Assistant app that allows you to record your Home Assistant dashboards as animated webp or mp4 files. Useful when the HA framework is too heavy to load on your old devices, or if you want to use the extracted dashboard as a screensaver on your TV.

## Installation
[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fniektuytel%2Fha-extractor-app)

1. Add the repository to your Home Assistant instance:
```
https://github.com/niektuytel/ha-extractor-app
```
2. Install the app

## Recording multiple pages

Add a `pages` list in the app's configuration (use the YAML editor):

```yaml
pages:
  - name: living-room
    url: "http://homeassistant:8123/lovelace/living-room?kiosk"
  - name: kitchen
    url: "http://homeassistant:8123/lovelace/kitchen?kiosk"
output_path: "/config/www/ha-extractor/output"
output_type: "mp4"
```

Each page is recorded on startup and on every `cron` run, in list order. All
pages share the token, resolution, zoom, duration, loading, and encoding settings.
Recordings run one at a time, and encoding is queued. A failed page does not
prevent the remaining pages from being recorded. If a recording batch is still
running when the next scheduled run arrives, that run is skipped.

The directory containing `output_path` holds the generated files. Page names
must be unique and use lowercase letters, numbers, hyphens, or underscores,
starting with a letter or number. With the example above, the files are:

| Page | Player URL in Home Assistant | Recording |
| --- | --- | --- |
| Living room | `/local/ha-extractor/living-room.html` | `living-room.mp4` |
| Kitchen | `/local/ha-extractor/kitchen.html` | `kitchen.mp4` |

Open those player URLs on your tablet or TV. Each player loops its recording and
automatically picks up updates using its own `.version` file. For animated WebP,
set `output_type: "webp"`; the players use `.webp` recordings instead.

With `pages: []` (the default), the app uses the existing `url` option and writes
`output.mp4` or `output.webp` plus `index.html`, preserving single-page setups.
When `pages` is populated, it replaces the single `url`; the filename portion of
`output_path` is ignored. Existing generated files are not removed when you
change the list. With `retain_profile: true`, each dashboard keeps its own open
tab between recording runs, which uses more memory as you add pages.

For standalone runs, supply the same list as JSON in the `PAGES` environment
variable, for example:

```text
PAGES=[{"name":"living-room","url":"http://homeassistant:8123/lovelace/living-room?kiosk"},{"name":"kitchen","url":"http://homeassistant:8123/lovelace/kitchen?kiosk"}]
```

Run the automated checks with `npm test` from `ha_extractor`.
