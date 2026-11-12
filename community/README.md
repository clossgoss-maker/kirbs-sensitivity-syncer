# Shared game library

Every file in `games/` is one game's **setup**: where its config file lives, which settings to change, their ranges and FOV type. The app downloads `games.json` (built from these files) at startup, so everyone gets new games without reinstalling.

**No calibration numbers live here.** They come from mouse-sensitivity.com, whose terms don't allow redistributing them. Everyone calibrates each game once with the site panel in the app.

## Adding a game

- **From the app (easiest):** open the game's **Set up**, click **Share with everyone…**, then **Open on GitHub**. That opens a pre-filled issue.
- **Maintainers:** check the issue, then add the **approved** label. A workflow validates the profile and opens a pull request. Merge it and the game is live.
- **By hand:** add `games/<id>.json`, run `node scripts/build-community.js`, and open a pull request. CI checks it.

Paths must start with `{STEAMLIB}/`, `{STEAM}/`, `{DOCUMENTS}/`, `{SAVEDGAMES}/`, `%LOCALAPPDATA%/`, `%APPDATA%/` or `%USERPROFILE%/` and point at a config file. Anything else is rejected, so a shared game can only ever touch game config files.
