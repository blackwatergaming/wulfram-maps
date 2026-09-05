# Wulfram Maps

This repository stores the canonical, reviewable sources for Wulfram maps.
Compiled game files are intentionally kept out of Git and published as
[GitHub Release](https://github.com/blackwatergaming/wulfram-maps/releases)
artifacts.

Each `maps/<slug>/` directory contains:

- `map.json` — dimensions, validation settings, and source metadata
- `terrain.tsv` — one terrain pixel/vertex per line
- `entities.jsonl` — one base unit per line
- `base-layouts.json` — all named states, when present
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
```

Run the approval checks from this maps checkout after installing the sibling
editor's dependencies:

```bash
npm test
npm run validate
```

CI checks every map directory, `entities.jsonl`, every named layout (including
inactive layouts), and any original `state`, `state1`, `state2`, `db_state`,
`bigstate`, or `.state` files present. It uses the pinned editor's source parser
and gameplay validator. Every state must give **both teams an uplink and a repair
pad within same-team power-cell range**. Malformed sources, invalid validation
settings, out-of-bounds units, and a stale active-state projection also fail.
Editor slope, overlap, and individual-unit power warnings remain advisory;
these placement heuristics do not invalidate stock map data.
Terrain cells using `backface`, including blended layers, produce an unpainted
terrain warning with the affected cell count and first location. Unused texture
tags and padding do not trigger it, and the warning does not block builds.

Source data can stay in the repository while a map is incomplete. There are no
stock exemptions for the team infrastructure requirement: `arena_alley`,
`arena_city`, `trainers_maze`, and `meltdown-meltdown` currently block approval
and release builds until bases are supplied for both teams.

To inspect all findings as JSON:

```bash
npm run validate -- --report dist/validation-report.json
```

Releases use the [Release maps workflow](.github/workflows/release-maps.yml).
Push an annotated `v*` tag on a reviewed `main` commit as described in
[CONTRIBUTING.md](CONTRIBUTING.md). The workflow requires the same validation and
compilation checks as a pull request before building and publishing each Wulfram
package, the collection ZIP, and `SHA256SUMS.txt`. `npm run release:build -- v1.0.0`
provides the same validated artifact build locally without publishing anything.
