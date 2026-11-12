'use strict';
// Sensitivity + FOV math. Everything is plain functions so it can be unit-tested.

const CM_PER_INCH = 2.54;
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

/** Mouse counts needed for one full 360 at a given cm/360 and DPI. */
function countsPer360(cm360, dpi) {
  return (cm360 / CM_PER_INCH) * dpi;
}

/**
 * In-game sensitivity value for a linear game:  degrees per count = yaw * sens
 *   sens = 360 / (yaw * counts)
 */
function sensFromCm(cm360, dpi, yaw) {
  if (!(cm360 > 0 && dpi > 0 && yaw > 0)) throw new Error('cm/360, DPI and yaw must all be > 0');
  return 360 / (yaw * countsPer360(cm360, dpi));
}

/** Inverse: what cm/360 does a given sensitivity produce? */
function cmFromSens(sens, dpi, yaw) {
  return (360 / (yaw * sens * dpi)) * CM_PER_INCH;
}

/**
 * Calibrate an unknown game's yaw from one measurement:
 * "with sensitivity S at DPI D, a full 360 took C cm".
 */
function yawFromMeasurement(sens, dpi, cm360) {
  return 360 / (sens * countsPer360(cm360, dpi));
}

// ---------------- FOV ----------------
// Canonical internal form = vertical FOV in degrees.
// Supported FOV "types":
//   'v'      vertical degrees
//   'h43'    horizontal degrees measured at 4:3 (Source / Apex style "Hor+")
//   'h169'   horizontal degrees at 16:9
//   'hnative' horizontal degrees at the user's actual aspect ratio
function aspectOf(type, nativeAspect) {
  if (type === 'h43') return 4 / 3;
  if (type === 'h169') return 16 / 9;
  if (type === 'hnative') return nativeAspect;
  return null;
}

function toVertical(value, type, nativeAspect = 16 / 9) {
  if (type === 'v') return value;
  const a = aspectOf(type, nativeAspect);
  if (!a) throw new Error(`Unknown FOV type "${type}"`);
  return deg(2 * Math.atan(Math.tan(rad(value) / 2) / a));
}

function fromVertical(vdeg, type, nativeAspect = 16 / 9) {
  if (type === 'v') return vdeg;
  const a = aspectOf(type, nativeAspect);
  if (!a) throw new Error(`Unknown FOV type "${type}"`);
  return deg(2 * Math.atan(Math.tan(rad(vdeg) / 2) * a));
}

function convertFov(value, fromType, toType, nativeAspect = 16 / 9) {
  return fromVertical(toVertical(value, fromType, nativeAspect), toType, nativeAspect);
}

/**
 * Map a FOV in degrees to the number the config file wants.
 * map: undefined/'identity'  -> same number
 *      {kind:'linear', fov:[a,b], value:[x,y]}  -> straight-line interpolation (e.g. Apex cl_fovScale)
 */
function fovToConfigValue(fovDeg, map) {
  if (!map || map === 'identity' || map.kind === 'identity') return fovDeg;
  if (map.kind === 'linear') {
    const [f0, f1] = map.fov;
    const [v0, v1] = map.value;
    return v0 + ((fovDeg - f0) * (v1 - v0)) / (f1 - f0);
  }
  throw new Error(`Unknown FOV map kind "${map.kind}"`);
}

/** Inverse of fovToConfigValue: config number -> FOV degrees. */
function configValueToFov(value, map) {
  if (!map || map === 'identity' || map.kind === 'identity') return value;
  if (map.kind === 'linear') {
    const [f0, f1] = map.fov;
    const [v0, v1] = map.value;
    return f0 + ((value - v0) * (f1 - f0)) / (v1 - v0);
  }
  throw new Error(`Unknown FOV map kind "${map.kind}"`);
}

function round(n, decimals = 6) {
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

module.exports = {
  countsPer360,
  sensFromCm,
  cmFromSens,
  yawFromMeasurement,
  toVertical,
  fromVertical,
  convertFov,
  fovToConfigValue,
  configValueToFov,
  round,
};
