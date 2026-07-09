# Fresh Snacks

A snack tab tracker hosted entirely on GitHub Pages — no backend server. The
"database" is [`data.json`](data.json) in this repo; pages read it with plain
`fetch` and write it through the GitHub Contents API.

## Pages

| Page | Purpose |
|---|---|
| [`index.html`](index.html) | Customer profile — running balance, stats, monthly snack log. Read-only. |
| [`admin.html`](admin.html) | Snack keeper's page — add entries/payments, edit or delete anything, manage the snack catalog and prices. |
| [`bins.html`](bins.html) | Self-serve — the customer taps the snacks they took from the bins and adds them to their own tab (entries are tagged `source: "self"`). |

## How CRUD works

- **Read** — every page fetches `data.json` through the GitHub Contents API
  (always fresh), falling back to the copy served by GitHub Pages.
- **Create / Update / Delete** — the page fetches the latest `data.json` and
  its blob `sha`, applies the change, and `PUT`s it back via
  `PUT /repos/{owner}/{repo}/contents/data.json`. The `sha` guard means a
  conflicting write returns 409 and the page retries on the fresh copy, so
  concurrent writes don't clobber each other. Every change is a git commit,
  so the full history of the tab is auditable with `git log`.

### Data shape

```jsonc
{
  "profile":  { "brand", "currency", "openingLabel", "favoriteSnackId", ... },
  "catalog":  [ { "id", "name", "price", "calories", "style", "factsId" } ],
  "entries":  [ { "id", "date|null", "snackId|label", "count", "value", "source" } ],
  "payments": [ { "id", "date|null", "amount", "note" } ]
}
```

`date: null` puts a record in the "opening history" bucket; dated records are
grouped by month automatically. Totals and the balance are always computed
from the raw records, never stored.

### Nutrition facts

A snack with `"factsId": "0001"` has its nutrition facts label image at
[`nutritional-facts/0001.jpg`](nutritional-facts/0001.jpg). Snack pills on the
profile page and the "Nutrition facts" links on the bins page open it in a
lightbox. Upload new labels from the admin catalog (images are resized
on-device and committed through the same Contents API); the next free
four-digit ID is assigned automatically.

## Setup for writing (admin + bins devices)

1. GitHub → Settings → Developer settings → **Fine-grained personal access
   tokens** → Generate new token.
2. Repository access: **only this repo** (`fresh-snacks`).
3. Permissions: **Contents → Read and write**. Nothing else.
4. Paste the token into the "Device access" box on `admin.html` (or the
   one-time setup box on `bins.html`). It's stored in that browser's
   localStorage only.

> ⚠️ Anyone with the token (or with hands on a connected device) can edit the
> tab and anything else in this repo the token covers — scope it to this repo
> only, and revoke/rotate it from GitHub settings if a device is lost. For a
> shared/public deployment you'd swap this for a tiny serverless proxy that
> holds the token server-side; for a personal honor-system tab, this is fine.

## Local development

Serve the folder with any static server (`python -m http.server`) — or just
open the files; reads go through the GitHub API so they work from `file://`
too.
