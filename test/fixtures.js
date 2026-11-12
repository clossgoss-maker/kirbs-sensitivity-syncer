'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../core/locate');
const E = require('../core/engine');

// ---------- fake Windows-ish machine ----------
function fakeMachine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sensync-'));
  const home = path.join(root, 'Users', 'me');
  const steam = path.join(root, 'Steam');
  const lib2 = path.join(root, 'D', 'SteamLibrary');
  const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };

  w(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib2.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
  w(path.join(steam, 'userdata', '12345', '730', 'local', 'cfg', 'cs2_user_convars_0_slot0.vcfg'),
    '"config"\n{\n\t"convars"\n\t{\n\t\t"sensitivity"\t\t"2.000000"\n\t}\n}\n');
  // TF2 installed on second library
  w(path.join(lib2, 'steamapps', 'appmanifest_440.acf'), '"AppState"\n{\n\t"appid"\t\t"440"\n\t"name"\t\t"Team Fortress 2"\n\t"installdir"\t\t"Team Fortress 2"\n}\n');
  w(path.join(lib2, 'steamapps', 'common', 'Team Fortress 2', 'tf', 'cfg', 'config.cfg'), 'sensitivity "3"\nfov_desired "75"\n');
  // Apex
  w(path.join(home, 'Saved Games', 'Respawn', 'Apex', 'local', 'settings.cfg'), 'mouse_sensitivity "2.500000"\n');
  w(path.join(home, 'Saved Games', 'Respawn', 'Apex', 'profile', 'profile.cfg'), 'cl_fovScale "1.000000"\n');
  // Siege
  w(path.join(home, 'Documents', 'My Games', 'Rainbow Six - Siege', 'abcd-1234', 'GameSettings.ini'),
    '[INPUT]\r\nMouseYawSensitivity=12\r\nMousePitchSensitivity=12\r\nMouseSensitivityMultiplierUnit=0.020000\r\n[DISPLAY_SETTINGS]\r\nDefaultFOV=60.000000\r\n');
  // An unknown Unreal game (for discovery)
  w(path.join(home, 'AppData', 'Local', 'Discovery', 'Saved', 'Config', 'WindowsClient', 'GameUserSettings.ini'),
    '[/Script/Discovery.DiscoveryGameUserSettings]\nMouseSensitivity=0.5\nFieldOfView=80\nResolutionSizeX=2560\n');
  w(path.join(home, 'AppData', 'Local', 'NeonRunner', 'Saved', 'Config', 'Windows', 'GameUserSettings.ini'),
    '[/Script/NeonRunner.Settings]\nMouseLookSensitivity=1.000000\nControllerSensitivity=0.7\nFOV=90.0\n');

  // CoD4 (for the mouse-sensitivity.com import), multiplayer config only
  w(path.join(lib2, 'steamapps', 'common', 'Call of Duty 4', 'players2', 'config_mp.cfg'),
    'unbindall\nbind W "+forward"\nseta 0xBC3E3CAE "5"\nseta 0x8572B2C7 "65"\n');

  // Cyberpunk-style named settings: user file under AppData/Local/<Company>/<Game>, and a defaults
  // file in the install folder that must never be picked
  const named = (name, value, def, min, max) => `                {\n                    "name": "${name}",\n                    "type": "float",\n                    "value": ${value},\n                    "default_value": ${def},\n                    "min_value": ${min},\n                    "max_value": ${max},\n                    "step_value": 1.0\n                }`;
  const cpJson = (opts) => `{\n    "version": 152,\n    "data": [\n        {\n            "group_name": "/controls/fppcameramouse",\n            "options": [\n${opts.join(',\n')}\n            ]\n        }\n    ]\n}\n`;
  w(path.join(home, 'AppData', 'Local', 'CD Projekt Red', 'Cyberpunk 2077', 'UserSettings.json'), cpJson([
    named('FPP_MouseX', '4.0', '5.0', '1.0', '30.0'), named('FPP_MouseY', '4.0', '5.0', '1.0', '30.0'),
    named('TPP_MouseX', '3.0', '3.0', '1.0', '30.0'), named('FieldOfView', '120.0', '80.0', '70.0', '120.0'),
  ]).replace(/\n/g, '\r\n'));
  w(path.join(lib2, 'steamapps', 'appmanifest_1091500.acf'), '"AppState"\n{\n\t"appid"\t\t"1091500"\n\t"name"\t\t"Cyberpunk 2077"\n\t"installdir"\t\t"Cyberpunk 2077"\n}\n');
  w(path.join(lib2, 'steamapps', 'common', 'Cyberpunk 2077', 'r6', 'config', 'settings', 'platform', 'pc', 'options.json'),
    cpJson([named('FPP_MouseX', '5.0', '5.0', '1.0', '30.0'), named('FPP_MouseY', '5.0', '5.0', '1.0', '30.0')]));

  // THE FINALS: binary UE save with string pairs
  const fstr = (t) => { const b = Buffer.from(t + '\0', 'latin1'); const l = Buffer.alloc(4); l.writeInt32LE(b.length); return Buffer.concat([l, b]); };
  const sav = Buffer.concat([Buffer.from('GVAS'), Buffer.alloc(40, 1),
    fstr('GameplayOption.Controls.ColorblindMode'), fstr('EUIColorblindMode::Default'),
    fstr('GameplayOption.Controls.MouseSensitivity'), fstr('37.0'),
    fstr('GameplayOption.Camera.FOV'), fstr('100.0'), Buffer.alloc(16)]);
  const savPath = path.join(home, 'AppData', 'Local', 'Discovery', 'Saved', 'SaveGames', 'EmbarkOptionSaveGame.sav');
  fs.mkdirSync(path.dirname(savPath), { recursive: true }); fs.writeFileSync(savPath, sav);

  const env = {
    USERPROFILE: home,
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    SENSYNC_STEAM: steam,
  };
  return { root, home, steam, lib2, env, ctx: L.makeContext({ env, platform: 'linux' }), st: E.store(path.join(root, 'appdata')) };
}

module.exports = { fakeMachine };
