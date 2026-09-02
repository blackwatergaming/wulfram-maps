# Wulfram Maps

This repository stores the canonical, reviewable sources for Wulfram maps.
Compiled game files are intentionally kept out of Git and published as
[GitHub Release](https://github.com/blackwatergaming/wulfram-maps/releases)
artifacts.

Each `maps/<slug>/` directory contains:

- `map.json` — dimensions, validation settings, and source metadata
- `terrain.tsv` — one terrain pixel/vertex per line
- `entities.jsonl` — one base unit per line
- `tagmap.txt` and `tagmap2.txt` — original texture mappings

The authoritative schema is [`schemas/wulfram-map-source-v1.schema.json`](schemas/wulfram-map-source-v1.schema.json).
The format is designed so terrain painting, elevation changes, and unit moves
produce focused text diffs that can be reviewed and merged normally.

Community map submissions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the fork, validation, pull-request, and administrator-review workflow.

## Edit and publish

Clone this repository beside
[`blackwatergaming/wulfram-mapeditor`](https://github.com/blackwatergaming/wulfram-mapeditor),
then run these commands from the editor checkout:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The Git branch control above the viewport lists
maps from this checkout. **Load** opens one, **Save** writes its canonical text
source locally, and **Publish** explicitly commits and pushes that map through
the loopback companion service.

The equivalent local commands are:

```bash
npm run maps:list
npm run maps:compile -- --all
npm run maps:publish -- crossroads
npm run maps:release -- v1.0.0
```

`maps:release` requires a clean checkout. It deterministically builds every map,
pushes the annotated tag, and creates a GitHub Release with each Wulfram package,
a complete collection ZIP, and `SHA256SUMS.txt`. GitHub credentials remain in
local `git`/`gh`; the editor browser never receives them.
