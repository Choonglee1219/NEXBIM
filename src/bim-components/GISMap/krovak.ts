// Pure TypeScript S-JTSK / Krovak (EPSG:5514) projection utility
// Replaces the 'proj4' npm dependency to allow offline/standalone deployments.

const HALF_PI = Math.PI / 2;

interface Point3D {
  x: number;
  y: number;
  z: number;
}

// 🌐 Geodetic <-> Geocentric converters for datum shift (Helmert transform)
function geodeticToGeocentric(lonRad: number, latRad: number, height: number, es: number, a: number): Point3D {
  let Latitude = latRad;
  let Longitude = lonRad;

  if (Latitude < -HALF_PI && Latitude > -1.001 * HALF_PI) {
    Latitude = -HALF_PI;
  } else if (Latitude > HALF_PI && Latitude < 1.001 * HALF_PI) {
    Latitude = HALF_PI;
  }

  if (Longitude > Math.PI) {
    Longitude -= (2 * Math.PI);
  }

  const Sin_Lat = Math.sin(Latitude);
  const Cos_Lat = Math.cos(Latitude);
  const Sin2_Lat = Sin_Lat * Sin_Lat;
  const Rn = a / Math.sqrt(1.0 - es * Sin2_Lat);

  return {
    x: (Rn + height) * Cos_Lat * Math.cos(Longitude),
    y: (Rn + height) * Cos_Lat * Math.sin(Longitude),
    z: ((Rn * (1 - es)) + height) * Sin_Lat
  };
}

function geocentricToGeodetic(p: Point3D, es: number, a: number, b: number): Point3D {
  const genau = 1e-12;
  const genau2 = genau * genau;
  const maxiter = 30;

  const X = p.x;
  const Y = p.y;
  const Z = p.z;

  const P = Math.sqrt(X * X + Y * Y);
  const RR = Math.sqrt(X * X + Y * Y + Z * Z);

  let Longitude = 0;
  let Latitude = 0;
  let Height = 0;

  if (P / a < genau) {
    Longitude = 0.0;
    if (RR / a < genau) {
      return { x: 0, y: HALF_PI, z: -b };
    }
  } else {
    Longitude = Math.atan2(Y, X);
  }

  const CT = Z / RR;
  const ST = P / RR;
  let RX = 1.0 / Math.sqrt(1.0 - es * (2.0 - es) * ST * ST);
  let CPHI0 = ST * (1.0 - es) * RX;
  let SPHI0 = CT * RX;
  let iter = 0;

  let CPHI = 0;
  let SPHI = 0;
  let SDPHI = 0;

  do {
    iter++;
    const RN = a / Math.sqrt(1.0 - es * SPHI0 * SPHI0);
    Height = P * CPHI0 + Z * SPHI0 - RN * (1.0 - es * SPHI0 * SPHI0);
    const RK = es * RN / (RN + Height);
    RX = 1.0 / Math.sqrt(1.0 - RK * (2.0 - RK) * ST * ST);
    CPHI = ST * (1.0 - RK) * RX;
    SPHI = CT * RX;
    SDPHI = SPHI * CPHI0 - CPHI * SPHI0;
    CPHI0 = CPHI;
    SPHI0 = SPHI;
  } while (SDPHI * SDPHI > genau2 && iter < maxiter);

  Latitude = Math.atan(SPHI / Math.abs(CPHI));

  return {
    x: Longitude,
    y: Latitude,
    z: Height
  };
}

// 📐 S-JTSK / Krovak Projection Constants
const lat0 = 0.863937979737193; // 49.5°
const long0 = 0.7417649320975901 - 0.308341501185665; // 24.833°
const k0 = 0.9999;
const s45 = 0.785398163397448;
const s90 = 2 * s45;
const es_bessel = 0.006674372230614;
const e_bessel = Math.sqrt(es_bessel);
const a_bessel = 6377397.155;
const b_bessel = 6356078.96290035;

const alfa = Math.sqrt(1 + (es_bessel * Math.pow(Math.cos(lat0), 4)) / (1 - es_bessel));
const uq = 1.04216856380474;
const u0 = Math.asin(Math.sin(lat0) / alfa);
const g = Math.pow((1 + e_bessel * Math.sin(lat0)) / (1 - e_bessel * Math.sin(lat0)), alfa * e_bessel / 2);
const k_krovak = Math.tan(u0 / 2 + s45) / Math.pow(Math.tan(lat0 / 2 + s45), alfa) * g;
const n0 = a_bessel * Math.sqrt(1 - es_bessel) / (1 - es_bessel * Math.pow(Math.sin(lat0), 2));
const s0 = 1.37008346281555;
const n_krovak = Math.sin(s0);
const ro0 = k0 * n0 / Math.tan(s0);
const ad = s90 - uq;

// 🌐 WGS84 Constants
const a_wgs = 6378137.0;
const es_wgs = 0.006694379990141317;
const b_wgs = 6356752.314245179;

// Datum Shift parameters (towgs84 from EPSG:5514 = [589, 76, 480])
const dx = 589;
const dy = 76;
const dz = 480;

/**
 * Convert S-JTSK / Krovak (EPSG:5514) [Easting, Northing] to WGS84 [Longitude, Latitude] (Degrees)
 */
export function krovakToWgs84(east: number, north: number): [number, number] {
  // 1. Revert S-JTSK axes transformation
  let px = east;
  let py = north;
  let tmp = px;
  px = py;
  py = tmp;
  
  // Non-Czech projection axis correction (Czech has positive coordinates, standard has negative)
  py *= -1;
  px *= -1;

  // 2. Projection Inverse (Krovak grid coordinates to Bessel ellipsoid lat/lon)
  const ro = Math.sqrt(px * px + py * py);
  const eps = Math.atan2(py, px);
  const d = eps / Math.sin(s0);
  const s = 2 * (Math.atan(Math.pow(ro0 / ro, 1 / n_krovak) * Math.tan(s0 / 2 + s45)) - s45);
  const u = Math.asin(Math.cos(ad) * Math.sin(s) - Math.sin(ad) * Math.cos(s) * Math.cos(d));
  const deltav = Math.asin(Math.cos(s) * Math.sin(d) / Math.cos(u));
  
  const lon_bessel = long0 - deltav / alfa;
  let lat_bessel = u;

  let ok = 0;
  let iter = 0;
  let fi1 = u;
  do {
    lat_bessel = 2 * (Math.atan(Math.pow(k_krovak, -1 / alfa) * Math.pow(Math.tan(u / 2 + s45), 1 / alfa) * Math.pow((1 + e_bessel * Math.sin(fi1)) / (1 - e_bessel * Math.sin(fi1)), e_bessel / 2)) - s45);
    if (Math.abs(fi1 - lat_bessel) < 0.0000000001) {
      ok = 1;
    }
    fi1 = lat_bessel;
    iter += 1;
  } while (ok === 0 && iter < 15);

  // 3. Bessel Geodetic to Bessel Geocentric Cartesian
  const pGeocentricBessel = geodeticToGeocentric(lon_bessel, lat_bessel, 0, es_bessel, a_bessel);

  // 4. Shift Bessel Geocentric to WGS84 Geocentric (Helmert 3D translation)
  const pGeocentricWGS: Point3D = {
    x: pGeocentricBessel.x + dx,
    y: pGeocentricBessel.y + dy,
    z: pGeocentricBessel.z + dz
  };

  // 5. WGS84 Geocentric Cartesian to WGS84 Geodetic lat/lon
  const pGeodeticWGS = geocentricToGeodetic(pGeocentricWGS, es_wgs, a_wgs, b_wgs);

  // Convert radians to degrees
  const lonDeg = pGeodeticWGS.x * 180 / Math.PI;
  const latDeg = pGeodeticWGS.y * 180 / Math.PI;

  return [lonDeg, latDeg];
}

/**
 * Convert WGS84 [Longitude, Latitude] (Degrees) to S-JTSK / Krovak (EPSG:5514) [Easting, Northing]
 */
export function wgs84ToKrovak(lon: number, lat: number): [number, number] {
  const lonRad = lon * Math.PI / 180;
  const latRad = lat * Math.PI / 180;

  // 1. WGS84 Geodetic lat/lon to WGS84 Geocentric Cartesian
  const pGeocentricWGS = geodeticToGeocentric(lonRad, latRad, 0, es_wgs, a_wgs);

  // 2. Shift WGS84 Geocentric to Bessel Geocentric Cartesian (Inverse Helmert translation)
  const pGeocentricBessel: Point3D = {
    x: pGeocentricWGS.x - dx,
    y: pGeocentricWGS.y - dy,
    z: pGeocentricWGS.z - dz
  };

  // 3. Bessel Geocentric Cartesian to Bessel Geodetic lat/lon
  const pGeodeticBessel = geocentricToGeodetic(pGeocentricBessel, es_bessel, a_bessel, b_bessel);
  const lon_bessel = pGeodeticBessel.x;
  const lat_bessel = pGeodeticBessel.y;

  // 4. Projection Forward (Bessel ellipsoid lat/lon to Krovak grid)
  let delta_lon = lon_bessel - long0;
  if (Math.abs(delta_lon) > Math.PI) {
    delta_lon = delta_lon - (delta_lon < 0 ? -1 : 1) * 2 * Math.PI;
  }

  const gfi = Math.pow(((1 + e_bessel * Math.sin(lat_bessel)) / (1 - e_bessel * Math.sin(lat_bessel))), (alfa * e_bessel / 2));
  const u = 2 * (Math.atan(k_krovak * Math.pow(Math.tan(lat_bessel / 2 + s45), alfa) / gfi) - s45);
  const deltav = -delta_lon * alfa;
  const s = Math.asin(Math.cos(ad) * Math.sin(u) + Math.sin(ad) * Math.cos(u) * Math.cos(deltav));
  const d = Math.asin(Math.cos(u) * Math.sin(deltav) / Math.cos(s));
  const eps = n_krovak * d;
  const ro = ro0 * Math.pow(Math.tan(s0 / 2 + s45), n_krovak) / Math.pow(Math.tan(s / 2 + s45), n_krovak);

  // Non-Czech standard negative coords
  const py = -ro * Math.cos(eps);
  const px = -ro * Math.sin(eps);

  // S-JTSK axis transformation
  const easting = px;
  const northing = py;

  return [easting, northing];
}
