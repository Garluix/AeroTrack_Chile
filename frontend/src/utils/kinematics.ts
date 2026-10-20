import { KinematicAircraft } from '../types/telemetry';

const EARTH_RADIUS_M = 6371000.0;
const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

/**
 * Projects estimated position P_t on the Earth's sphere given:
 * - Initial coordinate P_0 = (lat0, lon0) in degrees
 * - Ground speed v (m/s)
 * - True track angle theta (degrees clockwise from true north)
 * - Elapsed time dtSec (seconds)
 *
 * Uses exact spherical trigonometry (Great Circle forward solution):
 *   delta = (v * dt) / R
 *   phi_t = asin(sin(phi_0)*cos(delta) + cos(phi_0)*sin(delta)*cos(theta))
 *   lambda_t = lambda_0 + atan2(sin(theta)*sin(delta)*cos(phi_0), cos(delta) - sin(phi_0)*sin(phi_t))
 */
export function projectGreatCirclePosition(
  lat0: number,
  lon0: number,
  velocityMs: number,
  trueTrackDeg: number,
  dtSec: number
): [number, number] {
  if (velocityMs <= 0.1 || dtSec <= 0) {
    return [lat0, lon0];
  }

  // Clamp dead-reckoning horizon to 25 seconds to prevent runaway extrapolation on lost contact
  const clampedDt = Math.min(25.0, Math.max(0.0, dtSec));
  const distanceMeters = velocityMs * clampedDt;
  const angularDistance = distanceMeters / EARTH_RADIUS_M;

  const phi0 = lat0 * DEG_TO_RAD;
  const lambda0 = lon0 * DEG_TO_RAD;
  const theta = trueTrackDeg * DEG_TO_RAD;

  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinDelta = Math.sin(angularDistance);
  const cosDelta = Math.cos(angularDistance);

  const sinPhiT = sinPhi0 * cosDelta + cosPhi0 * sinDelta * Math.cos(theta);
  const phiT = Math.asin(Math.max(-1.0, Math.min(1.0, sinPhiT)));

  const y = Math.sin(theta) * sinDelta * cosPhi0;
  const x = cosDelta - sinPhi0 * sinPhiT;
  const lambdaT = lambda0 + Math.atan2(y, x);

  const latT = phiT * RAD_TO_DEG;
  const lonT = (((lambdaT * RAD_TO_DEG) + 540.0) % 360.0) - 180.0;

  return [latT, lonT];
}

/**
 * Spherical Linear Interpolation (Slerp) between two geographic coordinates on the unit sphere.
 * Ensures smooth geodesic transitions without Euclidean distortion at high latitudes (e.g. FIR SCCF Magallanes).
 */
export function slerpGeoPosition(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number
): [number, number] {
  const alpha = Math.max(0.0, Math.min(1.0, t));
  if (alpha <= 0.0001) return [lat1, lon1];
  if (alpha >= 0.9999) return [lat2, lon2];

  const phi1 = lat1 * DEG_TO_RAD;
  const lam1 = lon1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const lam2 = lon2 * DEG_TO_RAD;

  // Convert spherical (lat, lon) to 3D unit vectors
  const x1 = Math.cos(phi1) * Math.cos(lam1);
  const y1 = Math.cos(phi1) * Math.sin(lam1);
  const z1 = Math.sin(phi1);

  const x2 = Math.cos(phi2) * Math.cos(lam2);
  const y2 = Math.cos(phi2) * Math.sin(lam2);
  const z2 = Math.sin(phi2);

  const dot = Math.max(-1.0, Math.min(1.0, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);

  if (omega < 1e-6) {
    return [
      lat1 + (lat2 - lat1) * alpha,
      lon1 + (lon2 - lon1) * alpha,
    ];
  }

  const sinOmega = Math.sin(omega);
  const w1 = Math.sin((1.0 - alpha) * omega) / sinOmega;
  const w2 = Math.sin(alpha * omega) / sinOmega;

  const x = w1 * x1 + w2 * x2;
  const y = w1 * y1 + w2 * y2;
  const z = w1 * z1 + w2 * z2;

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD_TO_DEG;
  const lon = Math.atan2(y, x) * RAD_TO_DEG;

  return [lat, lon];
}

/**
 * Shortest-arc angular interpolation for aircraft heading [0, 360).
 */
export function lerpAngleDeg(currentDeg: number, targetDeg: number, alpha: number): number {
  const diff = ((((targetDeg - currentDeg) % 360) + 540) % 360) - 180;
  return (((currentDeg + diff * alpha) % 360) + 360) % 360;
}

/**
 * Computes the signed along-track time offset (seconds) between the current rendered coordinate
 * (renderLat, renderLon) and a newly arrived transponder fix (fixLat, fixLon) along trueTrackDeg.
 * Prevents backward rubber-banding ("stuttering") when an upstream ADS-B feed delivers a fix
 * that is 0.5s - 3.5s older than our current client-side Dead Reckoning projection.
 */
export function computeMonotonicAnchorTimestamp(
  renderLat: number,
  renderLon: number,
  fixLat: number,
  fixLon: number,
  velocityMs: number,
  trueTrackDeg: number,
  nowMs: number
): number {
  if (velocityMs < 5.0) {
    return nowMs;
  }

  const meanLatRad = ((renderLat + fixLat) * 0.5) * DEG_TO_RAD;
  const dNorthMeters = (fixLat - renderLat) * DEG_TO_RAD * EARTH_RADIUS_M;
  const dEastMeters = (fixLon - renderLon) * DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(meanLatRad);

  const totalDistMeters = Math.hypot(dNorthMeters, dEastMeters);
  // If the aircraft jumped > 12 km (e.g. initial spawn or major course/sensor reset), use nowMs directly
  if (totalDistMeters > 12000) {
    return nowMs;
  }

  const theta = trueTrackDeg * DEG_TO_RAD;
  const trackEast = Math.sin(theta);
  const trackNorth = Math.cos(theta);

  // Signed distance from renderPosition to newFix along the heading vector:
  // If < 0, the newly received transponder fix is slightly BEHIND our current rendered position.
  const alongTrackMeters = dEastMeters * trackEast + dNorthMeters * trackNorth;

  if (alongTrackMeters < 0) {
    // Advance the virtual anchor timestamp into the past so P_objetivo(nowMs) is at least flush
    // with the current rendered position along-track, eliminating any backward snap!
    const lagSec = Math.min(8.0, Math.abs(alongTrackMeters) / velocityMs);
    return nowMs - lagSec * 1000.0;
  }

  return nowMs;
}

/**
 * Advances a single KinematicAircraft in-place for the current animation frame (60/120 FPS):
 * Implements continuous Spherical/Linear Lerp with Dead Reckoning:
 *   P(t) = P_anterior + (P_objetivo(t) - P_anterior) * alpha
 * where alpha is computed as a function of frameDtSec (Delta t).
 */
export function stepAircraftKinematics(
  ac: KinematicAircraft,
  nowMs: number,
  frameDtSec: number,
  highDetail = true
): void {
  ac.prevLat = ac.renderLat;
  ac.prevLon = ac.renderLon;

  if (ac.on_ground || ac.velocity < 1.0) {
    const alpha = Math.min(1.0, 1.0 - Math.exp(-6.0 * frameDtSec));
    ac.renderLat = ac.prevLat + (ac.anchorLat - ac.prevLat) * alpha;
    ac.renderLon = ac.prevLon + (ac.anchorLon - ac.prevLon) * alpha;
    ac.renderTrack = lerpAngleDeg(ac.renderTrack, ac.true_track, alpha);
    return;
  }

  // 1. Smoothly interpolate heading first so velocity integration follows the curved flight path
  const trackAlpha = Math.min(1.0, 1.0 - Math.exp(-5.5 * frameDtSec));
  ac.renderTrack = lerpAngleDeg(ac.renderTrack, ac.true_track, trackAlpha);

  // 2. Time elapsed since the authoritative anchor state was captured
  const elapsedSinceAnchorSec = Math.min(25.0, Math.max(0, (nowMs - ac.anchorTimestampMs) / 1000.0));
  const alpha = Math.min(1.0, 1.0 - Math.exp(-4.2 * frameDtSec));

  if (!highDetail) {
    // Fast cosine-corrected geodesic Dead Reckoning + Linear Lerp for continental/world view (12,000+ entities)
    const thetaRad = ac.true_track * DEG_TO_RAD;
    const cosLat = Math.max(0.15, Math.cos(ac.anchorLat * DEG_TO_RAD));
    const degPerMeterLat = RAD_TO_DEG / EARTH_RADIUS_M;
    const degPerMeterLon = degPerMeterLat / cosLat;

    const vNorth = ac.velocity * Math.cos(thetaRad);
    const vEast = ac.velocity * Math.sin(thetaRad);

    const targetLat = ac.anchorLat + vNorth * elapsedSinceAnchorSec * degPerMeterLat;
    const targetLon = ac.anchorLon + vEast * elapsedSinceAnchorSec * degPerMeterLon;

    const anteriorLat = ac.prevLat + vNorth * frameDtSec * degPerMeterLat;
    const anteriorLon = ac.prevLon + vEast * frameDtSec * degPerMeterLon;

    ac.renderLat = anteriorLat + (targetLat - anteriorLat) * alpha;
    ac.renderLon = anteriorLon + (targetLon - anteriorLon) * alpha;
    const targetAlt = Math.max(0, ac.anchorAlt + ac.vertical_rate * elapsedSinceAnchorSec);
    ac.renderAlt = ac.renderAlt + (targetAlt - ac.renderAlt) * alpha;
    return;
  }

  // 3. High-detail 3D Great Circle Slerp for regional/tactical zoom & locked aircraft
  const [targetLat, targetLon] = projectGreatCirclePosition(
    ac.anchorLat,
    ac.anchorLon,
    ac.velocity,
    ac.true_track,
    elapsedSinceAnchorSec
  );

  const [anteriorLat, anteriorLon] = projectGreatCirclePosition(
    ac.prevLat,
    ac.prevLon,
    ac.velocity,
    ac.renderTrack,
    frameDtSec
  );

  const [smoothedLat, smoothedLon] = slerpGeoPosition(
    anteriorLat,
    anteriorLon,
    targetLat,
    targetLon,
    alpha
  );

  ac.renderLat = smoothedLat;
  ac.renderLon = smoothedLon;

  const targetAlt = Math.max(0, ac.anchorAlt + ac.vertical_rate * elapsedSinceAnchorSec);
  ac.renderAlt = ac.renderAlt + (targetAlt - ac.renderAlt) * alpha;
}

/**
 * Emergency Squawk codes per ICAO Annex 10:
 * - 7500: Unlawful Interference (Hijacking)
 * - 7600: Radio Communications Failure (NORDO)
 * - 7700: General / Distress Emergency
 */
export function isEmergencySquawk(squawk: string | null | undefined): boolean {
  return squawk === '7500' || squawk === '7600' || squawk === '7700';
}

export function getSquawkAlertInfo(squawk: string | null | undefined): {
  isEmergency: boolean;
  code: string;
  label: string;
  severity: 'critical' | 'warning' | 'normal';
} {
  switch (squawk) {
    case '7700':
      return {
        isEmergency: true,
        code: '7700',
        label: 'EMERGENCIA GENERAL (MAYDAY)',
        severity: 'critical',
      };
    case '7600':
      return {
        isEmergency: true,
        code: '7600',
        label: 'FALLA DE COMUNICACIONES (NORDO)',
        severity: 'warning',
      };
    case '7500':
      return {
        isEmergency: true,
        code: '7500',
        label: 'INTERFERENCIA ILÍCITA (HIJACK)',
        severity: 'critical',
      };
    default:
      return {
        isEmergency: false,
        code: squawk || '----',
        label: 'OPERACIÓN NORMAL',
        severity: 'normal',
      };
  }
}

/**
 * Maps altitude (in meters) to an RGBA tuple [R, G, B, A] for aircraft icons and breadcrumb trails:
 * - Ground / < 1,500m: Emerald (#10b981)
 * - 1,500m - 6,000m: Cyan (#06b6d4)
 * - 6,000m - 10,000m: Sky / Indigo (#38bdf8 -> #818cf8)
 * - > 10,000m (Cruise FL330+): Amber / Violet-Magenta (#f59e0b -> #ec4899)
 */
export function getAltitudeColorRGBA(
  altitudeMeters: number,
  squawk?: string | null,
  isSelected?: boolean,
  pulsePhase = 1.0
): [number, number, number, number] {
  if (isEmergencySquawk(squawk)) {
    const intensity = Math.round(195 + 60 * pulsePhase);
    return [255, Math.round(45 * (1 - pulsePhase)), Math.round(65 * (1 - pulsePhase)), intensity];
  }

  if (isSelected) {
    return [250, 204, 21, 255]; // Tactical gold highlight (#facc15)
  }

  const clamped = Math.max(0, Math.min(13000, altitudeMeters));
  const ratio = clamped / 13000;

  if (ratio < 0.25) {
    const t = ratio / 0.25;
    return [
      Math.round(16 + (6 - 16) * t),
      Math.round(185 + (182 - 185) * t),
      Math.round(129 + (212 - 129) * t),
      245,
    ];
  } else if (ratio < 0.6) {
    const t = (ratio - 0.25) / 0.35;
    return [
      Math.round(6 + (56 - 6) * t),
      Math.round(182 + (189 - 182) * t),
      Math.round(212 + (248 - 212) * t),
      245,
    ];
  } else if (ratio < 0.85) {
    const t = (ratio - 0.6) / 0.25;
    return [
      Math.round(56 + (168 - 56) * t),
      Math.round(189 + (85 - 189) * t),
      Math.round(248 + (247 - 248) * t),
      250,
    ];
  } else {
    const t = (ratio - 0.85) / 0.15;
    return [
      Math.round(168 + (244 - 168) * t),
      Math.round(85 + (114 - 85) * t),
      Math.round(247 + (182 - 247) * t),
      255,
    ];
  }
}

/**
 * Zero-allocation RGBA writer directly into a pre-allocated Uint8Array buffer
 * for Deck.gl instanced WebGL rendering of 10,000+ simultaneous aircraft.
 */
export function writeAltitudeColorRGBA(
  target: Uint8Array,
  offset: number,
  altitudeMeters: number,
  squawk?: string | null,
  isSelected?: boolean,
  pulsePhase = 1.0
): void {
  if (isEmergencySquawk(squawk)) {
    target[offset] = 255;
    target[offset + 1] = Math.round(45 * (1 - pulsePhase));
    target[offset + 2] = Math.round(65 * (1 - pulsePhase));
    target[offset + 3] = Math.round(195 + 60 * pulsePhase);
    return;
  }

  if (isSelected) {
    target[offset] = 250;
    target[offset + 1] = 204;
    target[offset + 2] = 21;
    target[offset + 3] = 255;
    return;
  }

  const clamped = altitudeMeters < 0 ? 0 : altitudeMeters > 13000 ? 13000 : altitudeMeters;
  const ratio = clamped / 13000;

  if (ratio < 0.25) {
    const t = ratio / 0.25;
    target[offset] = (16 + (6 - 16) * t) | 0;
    target[offset + 1] = (185 + (182 - 185) * t) | 0;
    target[offset + 2] = (129 + (212 - 129) * t) | 0;
    target[offset + 3] = 245;
  } else if (ratio < 0.6) {
    const t = (ratio - 0.25) / 0.35;
    target[offset] = (6 + (56 - 6) * t) | 0;
    target[offset + 1] = (182 + (189 - 182) * t) | 0;
    target[offset + 2] = (212 + (248 - 212) * t) | 0;
    target[offset + 3] = 245;
  } else if (ratio < 0.85) {
    const t = (ratio - 0.6) / 0.25;
    target[offset] = (56 + (168 - 56) * t) | 0;
    target[offset + 1] = (189 + (85 - 189) * t) | 0;
    target[offset + 2] = (248 + (247 - 248) * t) | 0;
    target[offset + 3] = 250;
  } else {
    const t = (ratio - 0.85) / 0.15;
    target[offset] = (168 + (244 - 168) * t) | 0;
    target[offset + 1] = (85 + (114 - 85) * t) | 0;
    target[offset + 2] = (247 + (182 - 247) * t) | 0;
    target[offset + 3] = 255;
  }
}

// Aviation Unit Conversions
export const metersToFeet = (m: number): number => Math.round(m * 3.28084);
export const msToKnots = (ms: number): number => Math.round(ms * 1.94384);
export const msToKmh = (ms: number): number => Math.round(ms * 3.6);
export const msToFeetPerMin = (ms: number): number => Math.round(ms * 196.85);

/**
 * Estimates Mach number based on ISA speed of sound at altitude.
 */
export function msToMach(velocityMs: number, altitudeMeters: number): number {
  const tempKelvin = Math.max(216.65, 288.15 - 0.0065 * Math.min(11000, altitudeMeters));
  const speedOfSound = Math.sqrt(1.4 * 287.05 * tempKelvin);
  return Number((velocityMs / speedOfSound).toFixed(2));
}

/**
 * Generates a high-DPI 256x128 dual-icon atlas PNG data URL containing:
 * - Slot 0 [x: 0..128, pivot (64,64)]: Fixed-wing commercial jet ('aircraft') pointing North (0 deg).
 * - Slot 1 [x: 128..256, pivot (192,64)]: Top-down rotorcraft/helicopter ('helicopter') with main rotor,
 *   fuselage cabin, landing skids, and tail boom/rotor pointing North (0 deg).
 */
export function createAircraftIconAtlasDataUrl(): string {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 256, 128);

      // 1. Slot 0 (x: 0..128, center 64,64): Commercial Fixed-Wing Jet
      ctx.save();
      ctx.translate(64, 64);
      const jetPath = new Path2D(
        'M 0 -52 C 5 -42, 7 -28, 7 -12 L 48 12 L 48 20 L 7 8 L 6 34 L 22 45 L 22 51 L 0 44 L -22 51 L -22 45 L -6 34 L -7 8 L -48 20 L -48 12 L -7 -12 C -7 -28, -5 -42, 0 -52 Z'
      );
      ctx.fillStyle = '#ffffff';
      ctx.fill(jetPath);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineJoin = 'round';
      ctx.stroke(jetPath);
      ctx.restore();

      // 2. Slot 1 (x: 128..256, center 192,64): Top-Down Rotorcraft / Helicopter
      ctx.save();
      ctx.translate(192, 64);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Landing skids & struts
      const skidsPath = new Path2D(
        'M -18 -24 L -18 10 M 18 -24 L 18 10 M -18 -14 L -8 -14 M 18 -14 L 8 -14 M -18 2 L -8 2 M 18 2 L 8 2'
      );
      ctx.lineWidth = 3.5;
      ctx.stroke(skidsPath);

      // Helicopter streamlined cabin, tail boom, horizontal stabilizer, and tail rotor
      const heliBody = new Path2D(
        'M 0 -36 C 10 -36, 13 -22, 12 -6 C 11 6, 6 14, 3 18 L 2 44 L 15 44 L 15 49 L 2 49 L 2 54 L -2 54 L -2 49 L -15 49 L -15 44 L -2 44 L -3 18 C -6 14, -11 6, -12 -6 C -13 -22, -10 -36, 0 -36 Z'
      );
      ctx.fill(heliBody);

      // Subtle outer rotor wash ring
      ctx.beginPath();
      ctx.arc(0, -8, 44, 0, Math.PI * 2);
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // 4-blade main rotor X-cross centered over the main mast (0, -8)
      const bladesPath = new Path2D(
        'M -33 -41 L 33 25 M 33 -41 L -33 25'
      );
      ctx.lineWidth = 5.5;
      ctx.stroke(bladesPath);

      // Main rotor hub cap
      ctx.beginPath();
      ctx.arc(0, -8, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      return canvas.toDataURL('image/png');
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128" viewBox="0 0 256 128">
    <g transform="translate(64,64)">
      <path
        d="M 0 -52 C 5 -42, 7 -28, 7 -12 L 48 12 L 48 20 L 7 8 L 6 34 L 22 45 L 22 51 L 0 44 L -22 51 L -22 45 L -6 34 L -7 8 L -48 20 L -48 12 L -7 -12 C -7 -28, -5 -42, 0 -52 Z"
        fill="#ffffff"
      />
    </g>
    <g transform="translate(192,64)" fill="#ffffff" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round">
      <path d="M -18 -24 L -18 10 M 18 -24 L 18 10 M -18 -14 L -8 -14 M 18 -14 L 8 -14 M -18 2 L -8 2 M 18 2 L 8 2" stroke-width="3.5" fill="none" />
      <path d="M 0 -36 C 10 -36, 13 -22, 12 -6 C 11 6, 6 14, 3 18 L 2 44 L 15 44 L 15 49 L 2 49 L 2 54 L -2 54 L -2 49 L -15 49 L -15 44 L -2 44 L -3 18 C -6 14, -11 6, -12 -6 C -13 -22, -10 -36, 0 -36 Z" />
      <circle cx="0" cy="-8" r="44" stroke-width="2.2" fill="none" />
      <path d="M -33 -41 L 33 25 M 33 -41 L -33 25" stroke-width="5.5" fill="none" />
      <circle cx="0" cy="-8" r="6" />
    </g>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
