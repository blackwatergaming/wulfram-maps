# Contributing maps

Map contributions use GitHub's fork-and-pull-request workflow. The `main`
branch is the source for releases and accepts changes only through reviewed
pull requests.

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
cd ../wulfram-mapeditor
npm run maps:compile -- --all
```

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

Every pull request must compile successfully, resolve all review conversations,
and receive approval from a repository administrator. New commits invalidate
earlier approvals, and the person who made the latest change cannot supply the
final approval. Only an administrator can merge into `main`; releases are built
from reviewed `main` commits.
