import { BoundingBox, ChileanFIRCode } from '../types/telemetry.js';
import { CHILE_FIRS } from '../config/env.js';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encodes (lat, lon) into a standard base32 Geohash string at the requested precision (level 4-6).
 */
export function encodeGeohash(lat: number, lon: number, precision = 5): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90.0;
  let latMax = 90.0;
  let lonMin = -180.0;
  let lonMax = 180.0;

  const clampedLat = Math.max(-89.9999, Math.min(89.9999, lat));
  const clampedLon = Math.max(-179.9999, Math.min(179.9999, lon));

  while (geohash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (clampedLon >= lonMid) {
        idx = idx * 2 + 1;
        lonMin = lonMid;
      } else {
        idx = idx * 2;
        lonMax = lonMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (clampedLat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;

    if (++bit === 5) {
      geohash += BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

/**
 * Computes the set of Geohash prefixes (level 3-4) covering a given BoundingBox
 * for rapid spatial hashing and subscription filtering.
 */
export function getBboxGeohashPrefixes(bbox: BoundingBox, precision = 4): string[] {
  const prefixes = new Set<string>();
  const latSpan = Math.max(0.1, bbox.lamax - bbox.lamin);
  const lonSpan = Math.max(0.1, bbox.lomax - bbox.lomin);

  // Sample grid across the viewport to capture representative geohash prefixes
  const steps = 6;
  const dLat = latSpan / steps;
  const dLon = lonSpan / steps;

  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const lat = bbox.lamin + i * dLat;
      const lon = bbox.lomin + j * dLon;
      prefixes.add(encodeGeohash(lat, lon, precision));
    }
  }

  return Array.from(prefixes);
}

/**
 * Checks whether a point (lat, lon) lies inside a BoundingBox.
 */
export function isPointInBbox(lat: number, lon: number, bbox: BoundingBox): boolean {
  return (
    lat >= bbox.lamin &&
    lat <= bbox.lamax &&
    lon >= bbox.lomin &&
    lon <= bbox.lomax
  );
}

/**
 * Checks whether a target BoundingBox is completely contained within a reference BoundingBox.
 */
export function isBboxContainedIn(target: BoundingBox, reference: BoundingBox): boolean {
  return (
    target.lamin >= reference.lamin - 0.5 &&
    target.lomin >= reference.lomin - 0.5 &&
    target.lamax <= reference.lamax + 0.5 &&
    target.lomax <= reference.lomax + 0.5
  );
}

/**
 * Merges multiple BoundingBoxes into an expanded bounding box clamped to valid world bounds.
 */
export function mergeBoundingBoxes(boxes: BoundingBox[]): BoundingBox {
  let lamin = 90;
  let lomin = 180;
  let lamax = -90;
  let lomax = -180;

  for (const b of boxes) {
    if (b.lamin < lamin) lamin = b.lamin;
    if (b.lomin < lomin) lomin = b.lomin;
    if (b.lamax > lamax) lamax = b.lamax;
    if (b.lomax > lomax) lomax = b.lomax;
  }

  return {
    lamin: Math.max(-85, lamin),
    lomin: Math.max(-180, lomin),
    lamax: Math.min(85, lamax),
    lomax: Math.min(180, lomax),
  };
}

/**
 * Classifies a coordinate into one of Chile's 5 Flight Information Regions
 * (SCEZ, SCFA, SCTE, SCCF, SCIP) or 'INTL' if outside Chilean FIR jurisdiction.
 */
export function classifyChileanFIR(lat: number, lon: number): ChileanFIRCode {
  for (const fir of CHILE_FIRS) {
    if (isPointInBbox(lat, lon, fir.bbox)) {
      return fir.code;
    }
  }
  return 'INTL';
}
