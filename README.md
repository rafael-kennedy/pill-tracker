# Pill Tracker

An offline-first pill tracker. Install it to your phone's home screen from GitHub Pages.

- Add pills with optional instructions.
- Tap **Took it** to log a dose. Each pill shows how long ago it was last taken.
- Data lives only on your device, in IndexedDB.
- Back up and restore with CSV from the ⋯ menu.

## Why install to the Home Screen

iOS Safari can erase a website's stored data after about 7 days without use. Apps added to the Home Screen are exempt. Uninstalling the app still deletes its data, so keep CSV backups. The app nags after 7 days without one.

## CSV format

One file, one row per record.

| column | pill rows | dose rows |
|---|---|---|
| record | `pill` | `dose` |
| id | pill id | dose id |
| pill_id | | id of the pill |
| name | pill name | |
| instructions | optional | |
| taken_at | | ISO 8601 UTC |
| created_at | ISO 8601 UTC | |

Import merges by id. It never deletes.

## Development

No build step. Serve the folder with any static server, e.g. `python3 -m http.server`.
Bump `CACHE` in `sw.js` on each release so phones pick up the new files.
