# Shared game library

Every file in `games/` is one game, ready to go: where its config file lives, which settings to change, their ranges, FOV type, and the game's **yaw** (from the sharer's calibration), so friends don't have to calibrate it. The app downloads `games.json` (built from these files) at startup, so everyone gets new games without reinstalling.

- **Your calibration wins.** A shared yaw is only used until you calibrate the game yourself.
- **FOV-dependent games** store the FOV their yaw was calibrated at (`calFov`), and the app warns if you set a different FOV.
- **Wrong numbers:** open the game's **Set up** and click **Report a wrong value**.
- **Not for publishing widely:** yaws worked out with mouse-sensitivity.com's calculator are their numbers, and their terms don't allow redistributing them. This library is meant for a small group of friends who each have their own access to the site.

## Adding a game

- **From the app (easiest):** calibrate the game, open its **Set up**, click **Share with everyone…**, then **Open on GitHub**. That opens a pre-filled issue.
- **No GitHub account:** in the same dialog, click **Copy share code** and send it to the maintainer. The maintainer opens a [new "Share a game" issue](../../../issues/new?template=new-game.yml), pastes the code into **Game profile**, and approves it like any other.
- **Maintainers:** check the issue, then add the **approved** label. A workflow validates the profile, records it in the history, and opens a pull request. Merge it and the game is live.

## History (audit trail)

`history.json` records every change: the date, the game, whether it was added or updated, its **yaw** (and calibration FOV) at that point, who shared it and the issue it came from. The approval workflow writes entries automatically. CI refuses a game whose yaw doesn't match its latest history entry, so the trail can't drift from the data. In the app: **Shared library history** in the toolbar, or a shared game's **Set up**. The complete record of every change is also in this folder's git history.
- **By hand:** add `games/<id>.json`, run `node scripts/build-community.js`, and open a pull request. CI checks it.

Paths must start with `{STEAMLIB}/`, `{STEAM}/`, `{DOCUMENTS}/`, `{SAVEDGAMES}/`, `%LOCALAPPDATA%/`, `%APPDATA%/` or `%USERPROFILE%/` and point at a config file. Anything else is rejected, so a shared game can only ever touch game config files.
