# Contributing maps

Map contributions use GitHub's fork-and-pull-request workflow. The `main`
branch is the source for releases and accepts changes through validated
pull requests. Contributor changes require administrator review; either
repository administrator can complete their own release PR.

## One-time setup

Install Git, GitHub CLI, and Node.js 22.13 or newer. Authenticate GitHub CLI,
then fork the maps repository and clone both projects beside each other:

```bash
gh auth login
gh repo fork blackwatergaming/wulfram-maps --clone
gh repo clone blackwatergaming/wulfram-mapeditor
cd wulfram-mapeditor
npm install
```

The expected layout is:

```text
parent-directory/
├── wulfram-mapeditor/
└── wulfram-maps/
```

## Create or edit a map

Update your fork from the upstream repository and create a descriptive branch:

```bash
cd wulfram-maps
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c maps/example-map
```

From `wulfram-mapeditor`, run `npm run dev`, open `http://localhost:3000`, and
use **Save** to write canonical source into the sibling maps checkout. A map
belongs in `maps/<slug>/` and must include:

- `map.json`
- `terrain.tsv`
- `entities.jsonl`
- `tagmap.txt`
- `tagmap2.txt`

`base-layouts.json` is optional for maps without saved base layouts. Do not
commit compiled ZIP files or the ignored `dist/` directory.

Validate all sources before committing:

```bash
cd ../wulfram-maps
npm test
npm run validate
cd ../wulfram-mapeditor
npm run maps:compile -- --all
```

The validation command checks every map and every state, including inactive
layouts and original state-file variants. Each state must contain an uplink and
at least one repair pad within `max(0, serviceRadius - 10)` world units of a
same-team deployed power cell for **each of teams 1 and 2**, using that layout's
validation settings. Cargo and neutral units do not satisfy those requirements.

CI also checks source parsing, terrain dimensions and vertex rows, entity and
layout structure, validation-setting ranges, map boundaries, and consistency
between `entities.jsonl` and the active layout. Diagnostics identify the source
file, layout, and unit. Slope, overlap, individual-unit power, and buried-unit
findings are advisory, since stock states can legitimately trigger the editor's
placement heuristics. Warnings do not fail CI.

Any terrain cell using the `backface` texture also produces an **unpainted
terrain** warning. This includes blended texture layers. The warning reports
the affected cell count and first location in `terrain.tsv`; unused texture
tags and padding are ignored. Paint those cells in the editor to clear it.

There are no exceptions for stock states missing required team bases. Removed
maps must satisfy the same requirements before being restored. A valid active
state cannot hide an invalid inactive state, and every map in `maps/` is included
in an all-maps build.

## Open the pull request

External contributors should push to their fork and identify that fork in the
pull request command. Replace the example username and branch as needed:

```bash
cd ../wulfram-maps
git add -- maps/example-map
git commit -m "Add example map"
git push -u origin HEAD
gh pr create --repo blackwatergaming/wulfram-maps --base main --head YOUR_GITHUB_USERNAME:maps/example-map --fill
```

The editor's **Publish** action targets the upstream repository and is intended
for maintainers with write access. Fork contributors should use the commands
above.

## Review and release policy

Every pull request must pass **Validate maps**, compile successfully, and resolve
all review conversations. Contributor pull requests also require approval from a
repository administrator; new commits invalidate earlier approvals, and the
person who made the latest change cannot supply that approval. Administrators
`cyberbalsa` and `0xLogic` have a review exception so either can complete their
own release PR. Required CI checks, administrator enforcement, and force-push
and deletion restrictions remain enabled. Only an administrator can merge into
`main`; releases are built from validated `main` commits.

Keep **Validate maps** configured as a required status check in the `main`
branch protection or repository ruleset. The workflow runs on pull requests,
merge queue entries, pushes to `main`, and manual dispatches. Human approval
does not replace this required check.

One administrator can publish a release after the checks pass; a second
administrator is not required. Tag the merged commit from the maps checkout:

```bash
git switch main
git pull --ff-only
git tag -a v1.0.0 -m "Wulfram maps v1.0.0"
git push origin refs/tags/v1.0.0
```

The release workflow runs the same validation, tests, and compilation, verifies
that the tagged commit belongs to `main`, then builds and publishes the release.
The publishing job cannot run if validation fails. Its build command validates
again before creating artifacts:

```bash
npm run release:build -- v1.0.0
```

Use this tag-driven workflow instead of the editor's older `maps:release`
command, which publishes directly and does not run these repository checks.
