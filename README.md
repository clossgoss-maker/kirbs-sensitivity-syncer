# Kirb's Sensitivity Syncer

Named after Kirby, a very good boy who has never once worried about his cm/360.

Set your **cm/360**, **DPI** and **FOV** once. Kirb finds each game's config file, works out the right numbers, backs up the file, and writes them in.

## Install (Windows)

Download **`KirbsSensitivitySyncer-Setup-<version>.exe`** from the [Releases](../../releases/latest) page and run it. It installs for your user only (no admin needed) and adds a Start menu shortcut.

- **Updates are automatic.** When a new version is out, the app downloads it and shows *"Kirb fetched version …"* with a **Restart to update** button. It also installs when you next quit.
- **Windows may warn you** ("Windows protected your PC") because the installer isn't code-signed. Click **More info → Run anyway**.
- **New shared games arrive by themselves.** The app downloads the latest shared game library every time it starts, no update needed.

## Run from source

1. Install **Node.js LTS** from https://nodejs.org (one time).
2. Double-click **`Kirbs Sensitivity Syncer.bat`**. The first launch installs Electron (about a minute).

Build the installer yourself with `npm install` then `npm run dist`; it lands in `dist\`.

## Shared games

Games people add can be shared with everyone: open the game's **Set up** and click **Share with everyone…**. Only the game's **setup** is shared (where its config file is, which settings, ranges, FOV type), never your calibration or anything from mouse-sensitivity.com, so everyone calibrates each game once with the site panel. See [community/README.md](community/README.md) for how sharing and approval work.

## Releasing (maintainers)

1. Bump `"version"` in `package.json` and commit.
2. Tag and push: `git tag v0.2.0` then `git push --tags`.
3. The **Release** workflow builds the installer and publishes the GitHub Release. Installed apps pick it up on their next launch.

## Using it

1. **Top bar:** enter your cm/360, DPI, monitor aspect and (optionally) the FOV you want, e.g. `103`, horizontal 16:9. It saves automatically.
2. **Games list:** each game shows the sensitivity and FOV it will get.
   - **Apply** writes them (close the game first, because most games rewrite their config when they exit).
   - **Preview** shows exactly which lines change, without writing anything.
   - **Apply to all found games** does every installed game in one go.
   - **Set up** lets you choose the config file yourself, fix the scaling, or **restore the last backup**.
3. **Valorant / Overwatch 2** keep settings in your online account, so they show the number with a **Copy value** button.

## What am I using right now?

Each game shows a **now:** line. That's the sensitivity currently in its config, turned into cm/360 at your DPI (a ✓ means it already matches your target). Click **Use as target** on the game whose aim you like, and every other game gets synced to it. From the command line: `node cli.js read`.

This works for binary Unreal save files too. THE FINALS keeps its settings in `%LOCALAPPDATA%\Discovery\Saved\SaveGames\EmbarkOptionSaveGame.sav`, which Kirb reads but never writes (writing can corrupt it), so for that game you type the value in-game.

## Adding any game

Click **+ Add a game**:

1. Type the game's name and click **Search**. It looks in Steam libraries (and Steam Cloud `userdata`), `Saved Games`, `Documents\My Games`, `AppData\Local|Roaming|LocalLow` (Unreal games keep settings in `AppData\Local\<Project>\Saved\Config\Windows*\GameUserSettings.ini`). It lists the files that contain sensitivity or FOV settings. If a game uses an odd folder name, use **Choose file…**.
2. Pick the sensitivity setting (and the FOV setting, if you want it matched) and say what kind of FOV number the game uses.
3. Tell it how the sensitivity scales, **once**:
   - **Paste a value:** on mouse-sensitivity.com, convert to your current cm/360 for that game and paste the number. Kirb learns the scaling from it, so later cm/360 or DPI changes recalculate correctly. Tick *"Use this exact number"* for the rare game with a non-linear slider.
   - **Known engine:** pick the game's engine (Source/Source 2, Quake/id Tech 3, Overwatch, Call of Duty 2019+, Valorant) and the yaw is filled in for you, plus the FOV type where it's known. Only use this if the game keeps the engine's default scaling. Presets live in `core/presets.json`.
   - **I know a value's cm/360:** e.g. "sensitivity 2.0 gives 34 cm/360 at 800 DPI".
   - **Enter yaw:** degrees per count, if you know it (Source 0.022, Valorant 0.07, Overwatch 0.0066).

If you never launched the game, start it once, change any setting and quit, so it creates its config file.

### Paste from mouse-sensitivity.com

Instead of searching, you can look the game up on mouse-sensitivity.com, select the whole **Game Info** box at the bottom, copy it, and paste it into **Add a game**. Kirb reads it and fills in the form for you to check:

- the config file (it looks for `[GAME FOLDER]` paths in your Steam libraries), the sensitivity and FOV settings, and their allowed ranges
- the FOV type, when it's one Kirb knows
- games set in-game only (no config file) become **Type in-game** games that show the value to type
- games whose result depends on other settings (like Deadlock) are set to use the exact number you paste

You still set the scaling once (Paste a value, Known engine, or yaw), because the box doesn't include it. Nothing is fetched from the site: you copy the box yourself, and it stays on your PC.

**When a paste isn't understood:** the rules live in `core/import-rules.json` (labels, line formats, FOV type wording, path tokens, engine presets). Add the rule there, then save the paste as `test/import-samples/<game>.txt` with what it should produce in `<game>.expected.json`. `npm test` checks every sample.

## Safety

- Every Apply copies the original files to `%APPDATA%\SensSync\backups\<game>\<time>\` first. **Set up → Restore last backup** puts them back.
- Only the value is changed. Formatting, comments, line endings and other settings are left alone.
- If the game is running (for games with a known .exe), it warns you before writing.
- Read-only config files are written and then set back to read-only.

## Command line

```
node cli.js set --cm 34.6 --dpi 800 --fov 103 --fov-type h169
node cli.js list
node cli.js preview all
node cli.js apply apex
node cli.js calibrate r6siege --sens 0.0185      (value that gives your current cm/360)
node cli.js discover "game name"
node cli.js restore apex
```

## FOV types

| Type | Meaning | Examples |
|---|---|---|
| `h169` | horizontal degrees at 16:9 | Overwatch |
| `h43` | horizontal degrees at 4:3 | Source games, Apex, CS |
| `v` | vertical degrees | Siege `DefaultFOV`, many Unreal games |
| `hnative` | horizontal at your actual monitor aspect | some Unreal/Unity games |

## Built-in games

| Game | What it edits | Notes |
|---|---|---|
| Counter-Strike 2 | `Steam\userdata\*\730\local\cfg\cs2_user_convars_0_slot0.vcfg` | FOV is fixed |
| Apex Legends | `Saved Games\Respawn\Apex\local\settings.cfg` + `profile\profile.cfg` (`cl_fovScale`) | |
| Team Fortress 2 | `tf\cfg\config.cfg` (and the Steam Cloud copy) | FOV 75 to 90 |
| Rainbow Six Siege | `Documents\My Games\Rainbow Six - Siege\*\GameSettings.ini` | sliders set to 50, value goes in the multiplier (derived scale, check once) |
| THE FINALS | reads `EmbarkOptionSaveGame.sav` | yaw 0.001; type the value in-game |
| Valorant, Overwatch 2 | (calculate only) | settings are saved to your online account |

Built-in profiles live in `core/games.json`. Games you add go to `%APPDATA%\SensSync\games.user.json`.

## Limits

- Hipfire only. ADS and scope multipliers aren't handled yet.
- Games that store settings in binary files, the registry, or only in the cloud can't be edited. Use the calculated number instead.
- Steam Cloud can sometimes restore an older config. If a value reverts, apply again with Steam closed, or set it once in-game.
