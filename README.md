# RoboJacks REBUILT Scouting App

An offline-first match scouting app for the 2026 FIRST Robotics Competition game REBUILT. Each scout records observations on their own device; the scout captain imports their exported files to compile results. Fuel counts are estimates, not official scores.

## Get started

To publish on GitHub Pages, make the repository public, then open its **Settings > Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save. Once published, share the URL shown in Pages settings (normally `https://whistlepunkprogram.github.io/rebuilt-scouting/`). Publishing the app does not upload scouting data. Do not put scouting data or secrets in this public repository.

Alternatively, serve this directory over HTTPS (or localhost for testing). For example, run `python3 -m http.server 8000` and open `http://localhost:8000`. A production deployment must use HTTPS; opening `index.html` directly does not enable offline installation. Host the files on a static HTTPS host accessible to every scout before the event.

On **each** device, open the deployed URL while online, wait for the offline-ready message, and keep the same browser and site address. Install it from the browser's menu if desired. Then test by turning off Wi-Fi and reloading the app before the event. On iOS, use Safari's Share > Add to Home Screen; open and verify the installed app separately.

## At an event

1. Enter the scout, team, match, predicted winning alliance and observations, then save. Records stay in this browser on this device.
2. Choose **Show transfer QR codes**. On the captain's device choose **Scan transfer QR codes**, allow camera access, and scan each code before advancing to the next. Keep both pages open until the captain sees the completed import. QR transfer requires a working camera and HTTPS (or localhost); the number of codes increases with the amount of data.
3. Alternatively, use **Export scouting file** to download a JSON backup and transfer it via AirDrop, Bluetooth, or a USB drive. On the captain's device, use **Import scouting files** to select each file. Reimporting data skips records already present. A conflicting ID is rejected rather than overwritten.
4. Review the team summary, selecting column headings to sort (teleop climbs sorts by success rate), and download CSV for spreadsheet analysis. Under **Scout awards**, enter the actual match results to calculate the top two prediction accuracies; the other leaderboard shows the top two scouts by matches scouted. Export a captain backup as well. For large collections, file transfer is faster than QR.

Each device holds one event at a time. Do not clear the device until the regional event is complete and you have been told to do so. Before another event, export and verify a backup on each device, then use the **Clear this device** section to remove records and results. Do not mix backups from different events or match phases with overlapping match numbers. Export backups frequently: browser storage can be cleared or evicted, and uninstalling or clearing site data can remove records. There is no account, cloud sync, automatic transfer, or recovery after data is deleted. CSV is a reporting export, not an import format.

Awards group scout names case-insensitively and count each match once per scout. When there are multiple submissions for a scout and match, the earliest saved record (by device timestamp, then record ID) supplies the prediction. Set device clocks correctly. A missing prediction, unknown result, or tied match is excluded from accuracy, not counted as incorrect. The highest percentage wins; ties are broken by number of judged predictions and then name. Match-count ties are broken by name. Existing records without predictions still count as scouted matches. Entering a result again updates it; conflicting results in imported backups are rejected. Backups and QR transfers include results; update every device before exchanging new-format files or QR codes. Older backups remain importable.

Older records and results keep their event names for reference, but summaries and awards now treat all data as one event. If older saved results conflict for a match, that match is excluded from accuracy until the captain saves the correct result. If older data contains multiple event names, review and back it up before clearing the device for a new event.

Fuel observations are approximate counts attributed to the scouted robot, not official alliance scores; only count fuel observed entering an active hub. Tower results are observed outcomes, not calculated official scores. Rules: [2026 game manual](https://firstfrc.blob.core.windows.net/frc2026/Manual/2026GameManual.pdf).

## Development

The checked-in QR libraries allow the app to run without a build or network dependency. Run `node --test` for the data validation and merge tests. When changing offline assets, update the cache version in `sw.js` and deploy all files together.
