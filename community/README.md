# Shared game library

Every file in `games/` is one game, ready to go: where its config file lives, which settings to change, their ranges, FOV type, and the game's **yaw** (from the sharer's calibration), so friends don't have to calibrate it. The app downloads `games.json` (built from these files) at startup, so everyone gets new games without reinstalling.

- **Your calibration wins.** A shared yaw is only used until you calibrate the game yourself.
- **FOV-dependent games** store the FOV their yaw was calibrated at (`calFov`), and the app warns if you set a different FOV.
- **Wrong numbers:** open the game's **Set up** and click **Report a wrong value**.
- **Not for publishing widely:** yaws worked out with mouse-sensitivity.com's calculator are their numbers, and their terms don't allow redistributing them. This library is meant for a small group of friends who each have their own access to the site.

## Adding a game

- **From the app (easiest):** calibrate the game, open its **Set up**, click **Share with everyone…**, then **Open on GitHub**. That opens a pre-filled issue.
- **Maintainers:** check the issue, then add the **approved** label. A workflow validates the profile and opens a pull request. Merge it and the game is live.
- **By hand:** add `games/<id>.json`, run `node scripts/build-community.js`, and open a pull request. CI checks it.

Paths must start with `{STEAMLIB}/`, `{STEAM}/`, `{DOCUMENTS}/`, `{SAVEDGAMES}/`, `%LOCALAPPDATA%/`, `%APPDATA%/` or `%USERPROFILE%/` and point at a config file. Anything else is rejected, so a shared game can only ever touch game config files.
