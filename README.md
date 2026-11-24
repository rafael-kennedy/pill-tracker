# Pill Tracker

An offline-first pill tracker. Install it to your phone's home screen from GitHub Pages.

- Add pills with optional instructions.
- **Hold a row for one second** to log a dose. A bar sweeps across the row, knocks the pill loose, and it falls into the mouth in the bottom bar. The dose is saved the instant the bar hits the pill.
- **Tap a row** to show instructions, recent doses, and Edit.
- Each pill shows how long ago it was last taken.
- Data lives only on your device, in IndexedDB.
- Back up and restore with CSV from the ⋯ menu.

## Why install to the Home Screen

iOS Safari can erase a website's stored data after about 7 days without use. Apps added to the Home Screen are exempt. Uninstalling the app still deletes its data, so keep CSV backups. The app nags after 7 days without one.

## Haptics

Android uses the Vibration API: accelerating ticks while holding, a firm double pulse when the dose is logged, a soft tap when the pill lands. iOS Safari has no Vibration API. On iOS 18+, the app flips a hidden native switch, which plays a system tick. Apple may remove this behavior.

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
