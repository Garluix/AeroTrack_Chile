import { CONFIG } from '../config/env.js';
import { classifyChileanFIR, encodeGeohash, isPointInBbox } from '../spatial/geohash.js';
import {
  AircraftPhotoMetadata,
  AircraftTelemetry,
  AirframeCategory,
  BoundingBox,
} from '../types/telemetry.js';
import { telemetryStore } from '../cache/redisStore.js';

const COUNTRY_BY_REGISTRATION_PREFIX: Array<[string, string]> = [
  ['CC-', 'Chile'],
  ['LV-', 'Argentina'],
  ['LQ-', 'Argentina'],
  ['PR-', 'Brazil'],
  ['PT-', 'Brazil'],
  ['PP-', 'Brazil'],
  ['PS-', 'Brazil'],
  ['OB-', 'Peru'],
  ['CP-', 'Bolivia'],
  ['HK-', 'Colombia'],
  ['HC-', 'Ecuador'],
  ['YV-', 'Venezuela'],
  ['CX-', 'Uruguay'],
  ['ZP-', 'Paraguay'],
  ['XA-', 'Mexico'],
  ['XB-', 'Mexico'],
  ['XC-', 'Mexico'],
  ['C-', 'Canada'],
  ['G-', 'United Kingdom'],
  ['F-', 'France'],
  ['D-', 'Germany'],
  ['EC-', 'Spain'],
  ['I-', 'Italy'],
  ['PH-', 'Netherlands'],
  ['HB-', 'Switzerland'],
  ['VH-', 'Australia'],
  ['ZK-', 'New Zealand'],
  ['JA', 'Japan'],
  ['HL', 'South Korea'],
  ['B-', 'China'],
  ['A6-', 'UAE'],
  ['A7-', 'Qatar'],
  ['N', 'United States'],
];

/**
 * Dictionary of common ICAO Aircraft Type Designators to full commercial model names
 * and airframe silhouette category ('twin-jet' | 'quad-jet' | 'turboprop').
 */
const ICAO_AIRCRAFT_MODELS: Record<string, { model: string; category: AirframeCategory }> = {
  A318: { model: 'Airbus A318-100', category: 'twin-jet' },
  A319: { model: 'Airbus A319-100', category: 'twin-jet' },
  A19N: { model: 'Airbus A319neo', category: 'twin-jet' },
  A320: { model: 'Airbus A320-214', category: 'twin-jet' },
  A20N: { model: 'Airbus A320neo', category: 'twin-jet' },
  A321: { model: 'Airbus A321-200', category: 'twin-jet' },
  A21N: { model: 'Airbus A321neo', category: 'twin-jet' },
  A332: { model: 'Airbus A330-200', category: 'twin-jet' },
  A333: { model: 'Airbus A330-300', category: 'twin-jet' },
  A339: { model: 'Airbus A330-900neo', category: 'twin-jet' },
  A343: { model: 'Airbus A340-300', category: 'quad-jet' },
  A346: { model: 'Airbus A340-600', category: 'quad-jet' },
  A359: { model: 'Airbus A350-900 XWB', category: 'twin-jet' },
  A35K: { model: 'Airbus A350-1000 XWB', category: 'twin-jet' },
  A388: { model: 'Airbus A380-800', category: 'quad-jet' },
  B733: { model: 'Boeing 737-300', category: 'twin-jet' },
  B734: { model: 'Boeing 737-400', category: 'twin-jet' },
  B737: { model: 'Boeing 737-700', category: 'twin-jet' },
  B738: { model: 'Boeing 737-800', category: 'twin-jet' },
  B739: { model: 'Boeing 737-900ER', category: 'twin-jet' },
  B38M: { model: 'Boeing 737 MAX 8', category: 'twin-jet' },
  B39M: { model: 'Boeing 737 MAX 9', category: 'twin-jet' },
  B744: { model: 'Boeing 747-400', category: 'quad-jet' },
  B748: { model: 'Boeing 747-8 Intercontinental', category: 'quad-jet' },
  B752: { model: 'Boeing 757-200', category: 'twin-jet' },
  B763: { model: 'Boeing 767-300ER', category: 'twin-jet' },
  B772: { model: 'Boeing 777-200ER', category: 'twin-jet' },
  B77L: { model: 'Boeing 777-200LR', category: 'twin-jet' },
  B77W: { model: 'Boeing 777-300ER', category: 'twin-jet' },
  B788: { model: 'Boeing 787-8 Dreamliner', category: 'twin-jet' },
  B789: { model: 'Boeing 787-9 Dreamliner', category: 'twin-jet' },
  B78X: { model: 'Boeing 787-10 Dreamliner', category: 'twin-jet' },
  E145: { model: 'Embraer ERJ-145', category: 'twin-jet' },
  E170: { model: 'Embraer E170', category: 'twin-jet' },
  E75L: { model: 'Embraer E175', category: 'twin-jet' },
  E190: { model: 'Embraer E190', category: 'twin-jet' },
  E195: { model: 'Embraer E195', category: 'twin-jet' },
  E295: { model: 'Embraer E195-E2', category: 'twin-jet' },
  B462: { model: 'BAe 146-200', category: 'quad-jet' },
  RJ85: { model: 'Avro RJ85', category: 'quad-jet' },
  RJ1H: { model: 'Avro RJ100', category: 'quad-jet' },
  LJ60: { model: 'Bombardier Learjet 60', category: 'twin-jet' },
  LJ45: { model: 'Bombardier Learjet 45', category: 'twin-jet' },
  CL60: { model: 'Bombardier Challenger 600', category: 'twin-jet' },
  GLF5: { model: 'Gulfstream G550', category: 'twin-jet' },
  GLF6: { model: 'Gulfstream G650ER', category: 'twin-jet' },
  C56X: { model: 'Cessna Citation Excel', category: 'twin-jet' },
  C68A: { model: 'Cessna Citation Latitude', category: 'twin-jet' },
  AT72: { model: 'ATR 72-500', category: 'turboprop' },
  AT76: { model: 'ATR 72-600', category: 'turboprop' },
  DH8C: { model: 'De Havilland Dash 8-300', category: 'turboprop' },
  DH8D: { model: 'De Havilland Dash 8-400', category: 'turboprop' },
  B350: { model: 'Beechcraft King Air 350', category: 'turboprop' },
  BE20: { model: 'Beechcraft Super King Air B200', category: 'turboprop' },
  PC12: { model: 'Pilatus PC-12 NGX', category: 'turboprop' },
  C208: { model: 'Cessna 208B Grand Caravan', category: 'turboprop' },
  C172: { model: 'Cessna 172 Skyhawk', category: 'turboprop' },
  PA31: { model: 'Piper PA-31 Navajo', category: 'turboprop' },
  C130: { model: 'Lockheed C-130H Hercules', category: 'turboprop' },
  C30J: { model: 'Lockheed Martin C-130J Super Hercules', category: 'turboprop' },
};

export function resolveAircraftModelInfo(
  typeCode?: string,
  rawDesc?: string
): { model: string; code: string; category: AirframeCategory } {
  const cleanCode = (typeCode || '').trim().toUpperCase();
  const known = ICAO_AIRCRAFT_MODELS[cleanCode];

  if (rawDesc && rawDesc.trim().length > 2) {
    return {
      model: rawDesc.trim(),
      code: cleanCode || 'ADSB',
      category: known?.category || inferCategoryFromCodeOrDesc(cleanCode, rawDesc),
    };
  }

  if (known) {
    return {
      model: known.model,
      code: cleanCode,
      category: known.category,
    };
  }

  if (cleanCode) {
    return {
      model: `Aeronave Tipo ${cleanCode}`,
      code: cleanCode,
      category: inferCategoryFromCodeOrDesc(cleanCode, ''),
    };
  }

  return {
    model: 'Aeronave Comercial ADS-B',
    code: 'ADSB',
    category: 'twin-jet',
  };
}

function inferCategoryFromCodeOrDesc(code: string, desc: string): AirframeCategory {
  const upper = `${code} ${desc}`.toUpperCase();
  if (
    upper.includes('747') ||
    upper.includes('B74') ||
    upper.includes('A34') ||
    upper.includes('A38') ||
    upper.includes('RJ85') ||
    upper.includes('RJ1') ||
    upper.includes('B46') ||
    upper.includes('C17') ||
    upper.includes('IL76')
  ) {
    return 'quad-jet';
  }
  if (
    upper.includes('ATR') ||
    upper.includes('AT7') ||
    upper.includes('DH8') ||
    upper.includes('DASH') ||
    upper.includes('C172') ||
    upper.includes('C208') ||
    upper.includes('PC12') ||
    upper.includes('PA2') ||
    upper.includes('PA3') ||
    upper.includes('BE20') ||
    upper.includes('B350') ||
    upper.includes('KING AIR') ||
    upper.includes('CESSNA 1') ||
    upper.includes('CESSNA 2') ||
    upper.includes('C130') ||
    upper.includes('HERCULES')
  ) {
    return 'turboprop';
  }
  return 'twin-jet';
}

function inferCountryFromRegOrHex(reg: string, hex: string, callsign: string): string {
  const upperReg = reg.toUpperCase();
  for (const [prefix, country] of COUNTRY_BY_REGISTRATION_PREFIX) {
    if (upperReg.startsWith(prefix)) {
      return country;
    }
  }
  const lowerHex = hex.toLowerCase();
  if (lowerHex.startsWith('e80')) return 'Chile';
  if (lowerHex.startsWith('e0')) return 'Argentina';
  if (lowerHex.startsWith('e4')) return 'Brazil';
  if (lowerHex.startsWith('a')) return 'United States';
  if (lowerHex.startsWith('c0')) return 'Canada';
  if (lowerHex.startsWith('40')) return 'United Kingdom';
  if (lowerHex.startsWith('34')) return 'Spain';
  if (lowerHex.startsWith('38') || lowerHex.startsWith('39')) return 'France';
  if (lowerHex.startsWith('3c')) return 'Germany';
  if (lowerHex.startsWith('7c')) return 'Australia';
  if (lowerHex.startsWith('c8')) return 'New Zealand';

  const upperCall = callsign.toUpperCase();
  if (
    upperCall.startsWith('LAN') ||
    upperCall.startsWith('LXP') ||
    upperCall.startsWith('SKU') ||
    upperCall.startsWith('JAT') ||
    upperCall.startsWith('DAP') ||
    upperCall.startsWith('FACH')
  ) {
    return 'Chile';
  }
  return 'ADS-B Live';
}

export class ADSBClient {
  private squawkOverrides = new Map<string, string>();
  private openSkyCooldownUntil = 0;
  private photoMetaCache = new Map<string, AircraftPhotoMetadata>();

  /**
   * Allows testing an emergency Squawk code ('7500', '7600', '7700', '1200')
   * on a live tracked aircraft from the HUD.
   */
  public setAircraftSquawk(icao24: string | undefined, squawk: string): string | null {
    const all = telemetryStore.getAllAircraft();
    const targetId =
      icao24?.toLowerCase() || (all.length > 0 ? all[0].icao24.toLowerCase() : null);
    if (!targetId) return null;

    if (squawk === '1200') {
      this.squawkOverrides.delete(targetId);
    } else {
      this.squawkOverrides.set(targetId, squawk);
    }
    return targetId;
  }

  /**
   * Fetches real aircraft photography from Planespotters.net Public API
   * (`https://api.planespotters.net/pub/photos/hex/${icao24}`) and exact airframe
   * model metadata from HexDB (`https://hexdb.io/api/v1/aircraft/${icao24}`),
   * merged with live ADS-B telemetry state.
   */
  public async fetchAircraftPhotoAndMetadata(icao24: string): Promise<AircraftPhotoMetadata> {
    const cleanHex = icao24.trim().toLowerCase();
    const cached = this.photoMetaCache.get(cleanHex);
    if (cached) {
      return cached;
    }

    const liveState = telemetryStore.getAircraft(cleanHex);
    const fallbackInfo = resolveAircraftModelInfo(
      liveState?.aircraft_code,
      liveState?.aircraft_model
    );

    let photoUrl: string | null = null;
    let photographer: string | null = null;
    let photoLink: string | null = null;
    let aircraftModel = fallbackInfo.model;
    let aircraftCode = fallbackInfo.code;
    let registration = liveState?.registration || cleanHex.toUpperCase();
    let operator: string | null = null;
    let category: AirframeCategory = fallbackInfo.category;

    const [psResult, hexDbResult] = await Promise.allSettled([
      fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(cleanHex)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AeroTrackChile/1.0 (+https://aerotrack.cl/contact)',
        },
        signal: AbortSignal.timeout(4500),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(cleanHex)}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AeroTrackChile/1.0 (+https://aerotrack.cl/contact)',
        },
        signal: AbortSignal.timeout(4000),
      }).then((r) => (r.ok ? r.json() : null)),
    ]);

    // 1. Extract exact airframe Manufacturer + Type + Registration from HexDB
    if (hexDbResult.status === 'fulfilled' && hexDbResult.value) {
      const h = hexDbResult.value as {
        Registration?: string;
        Manufacturer?: string;
        ICAOTypeCode?: string;
        Type?: string;
        RegisteredOwners?: string;
      };
      if (h.Registration) {
        registration = h.Registration.trim();
      }
      if (h.ICAOTypeCode) {
        aircraftCode = h.ICAOTypeCode.trim().toUpperCase();
      }
      if (h.Manufacturer && h.Type) {
        const mfg = h.Manufacturer.trim();
        const typ = h.Type.trim();
        aircraftModel = typ.toLowerCase().startsWith(mfg.toLowerCase())
          ? typ
          : `${mfg} ${typ}`;
      } else if (h.Type) {
        aircraftModel = h.Type.trim();
      } else if (h.ICAOTypeCode) {
        aircraftModel = resolveAircraftModelInfo(h.ICAOTypeCode).model;
      }
      if (h.RegisteredOwners) {
        operator = h.RegisteredOwners.trim();
      }
      category = inferCategoryFromCodeOrDesc(aircraftCode, aircraftModel);
    }

    // 2. Extract photograph and photographer attribution from Planespotters.net
    if (psResult.status === 'fulfilled' && psResult.value) {
      const ps = psResult.value as {
        photos?: Array<{
          thumbnail_large?: { src?: string };
          thumbnail?: { src?: string };
          src?: string;
          photographer?: string;
          link?: string;
        }>;
      };
      const firstPhoto = Array.isArray(ps.photos) && ps.photos.length > 0 ? ps.photos[0] : null;
      if (firstPhoto) {
        photoUrl =
          firstPhoto.thumbnail_large?.src ||
          firstPhoto.thumbnail?.src ||
          firstPhoto.src ||
          null;
        photographer = firstPhoto.photographer || 'Planespotters.net';
        photoLink = firstPhoto.link || null;
      }
    }

    const metadata: AircraftPhotoMetadata = {
      icao24: cleanHex,
      photoUrl,
      photographer,
      photoLink,
      aircraftModel,
      aircraftCode,
      registration,
      operator,
      category,
    };

    // Update live state in memory if available
    if (liveState) {
      liveState.aircraft_model = aircraftModel;
      liveState.aircraft_code = aircraftCode;
      liveState.registration = registration;
    }

    this.photoMetaCache.set(cleanHex, metadata);
    return metadata;
  }

  /**
   * Resilient HTTP fetch with exponential backoff + jitter.
   */
  private async fetchWithRetry(
    url: string,
    headers: Record<string, string> = {},
    retries = CONFIG.MAX_HTTP_RETRIES
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt < retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.HTTP_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'AeroTrack-Chile-TelemetryGateway/1.0',
            ...headers,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.status === 429) {
          const retryHeader = Number(res.headers.get('X-Rate-Limit-Retry-After-Seconds') || 45);
          throw Object.assign(new Error(`HTTP 429 Rate Limited (${retryHeader}s)`), {
            status: 429,
            retryAfter: retryHeader,
          });
        }

        if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status}: ${res.statusText}`), {
            status: res.status,
          });
        }

        return res;
      } catch (err) {
        clearTimeout(timeout);
        lastError = err;
        const status = (err as { status?: number })?.status;
        if (status === 400 || status === 429) {
          break;
        }
        if (attempt < retries - 1) {
          const delayMs = 300 * Math.pow(2, attempt) + Math.random() * 120;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    throw lastError;
  }

  /**
   * 1. Queries adsb.fi Open Data API v2:
   *    Parses both `data.aircraft` and `data.ac` arrays, including `t` (type code),
   *    `desc` (full aircraft model name), and `r` (registration).
   */
  private async fetchAdsbFi(bbox: BoundingBox): Promise<AircraftTelemetry[]> {
    const isDefaultChile =
      Math.abs(bbox.lamin - CONFIG.CHILE_DEFAULT_BBOX.lamin) < 2 &&
      Math.abs(bbox.lomin - CONFIG.CHILE_DEFAULT_BBOX.lomin) < 2;

    const queryLat = isDefaultChile
      ? -33.4489
      : Number(((bbox.lamin + bbox.lamax) / 2).toFixed(4));
    const queryLon = isDefaultChile
      ? -70.6693
      : Number(((bbox.lomin + bbox.lomax) / 2).toFixed(4));

    const candidateUrls = [
      `${CONFIG.ADSBFI_BASE_URL}/lat/${queryLat}/lon/${queryLon}/dist/250`,
      `${CONFIG.ADSBFI_BASE_URL}/lat/-33.4489/lon/-70.6693/dist/250`,
    ];

    const normalizedMap = new Map<string, AircraftTelemetry>();
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    for (const url of new Set(candidateUrls)) {
      try {
        const response = await this.fetchWithRetry(url, {}, 2);
        const data = (await response.json()) as {
          aircraft?: Array<Record<string, unknown>>;
          ac?: Array<Record<string, unknown>>;
        };

        const rawList = Array.isArray(data.aircraft)
          ? data.aircraft
          : Array.isArray(data.ac)
          ? data.ac
          : [];

        for (const item of rawList) {
          const hex = typeof item.hex === 'string' ? item.hex.trim().toLowerCase() : '';
          const lat = typeof item.lat === 'number' ? item.lat : null;
          const lon = typeof item.lon === 'number' ? item.lon : null;
          if (!hex || lat === null || lon === null) continue;

          const rawFlight = typeof item.flight === 'string' ? item.flight.trim() : '';
          const reg = typeof item.r === 'string' ? item.r.trim() : '';
          const typeCode = typeof item.t === 'string' ? item.t.trim() : '';
          const rawDesc = typeof item.desc === 'string' ? item.desc.trim() : '';
          const callsign = rawFlight || reg || hex.toUpperCase();

          const modelInfo = resolveAircraftModelInfo(typeCode, rawDesc);

          const altBaroFt = typeof item.alt_baro === 'number' ? item.alt_baro : 0;
          const altGeomFt = typeof item.alt_geom === 'number' ? item.alt_geom : altBaroFt;
          const gsKnots = typeof item.gs === 'number' ? item.gs : 0;
          const track = typeof item.track === 'number' ? item.track : 0;
          const baroRateFpm =
            typeof item.baro_rate === 'number'
              ? item.baro_rate
              : typeof item.geom_rate === 'number'
              ? item.geom_rate
              : 0;
          const rawSquawk = typeof item.squawk === 'string' ? item.squawk.trim() : null;
          const squawk = this.squawkOverrides.get(hex) ?? (rawSquawk || '1200');

          normalizedMap.set(hex, {
            icao24: hex,
            callsign,
            origin_country: inferCountryFromRegOrHex(reg, hex, callsign),
            lat,
            lon,
            baro_altitude: Math.max(0, Math.round(altBaroFt * 0.3048)),
            geo_altitude: Math.max(0, Math.round(altGeomFt * 0.3048)),
            velocity: Number((gsKnots * 0.514444).toFixed(1)),
            true_track: ((track % 360) + 360) % 360,
            vertical_rate: Number((baroRateFpm * 0.00508).toFixed(2)),
            squawk,
            on_ground: item.alt_baro === 'ground' || (altBaroFt <= 0 && gsKnots < 35),
            last_contact: nowSec,
            geohash: encodeGeohash(lat, lon, CONFIG.SPATIAL_GEOHASH_PRECISION),
            fir: classifyChileanFIR(lat, lon),
            source: 'adsbfi',
            server_timestamp: now,
            registration: reg || undefined,
            aircraft_code: modelInfo.code,
            aircraft_model: modelInfo.model,
          });
        }
      } catch {
        // Proceed to next endpoint
      }
    }

    return Array.from(normalizedMap.values());
  }

  /**
   * 2. Queries real-time ADS-B bounding-box transponder feed covering the full active BoundingBox
   *    (Chilean FIRs SCEZ/SCFA/SCTE/SCCF/SCIP + global viewports when the user pans/zooms).
   */
  private async fetchLiveBboxFeed(bbox: BoundingBox): Promise<AircraftTelemetry[]> {
    const lamax = Math.min(85, Math.max(-85, bbox.lamax)).toFixed(2);
    const lamin = Math.min(85, Math.max(-85, bbox.lamin)).toFixed(2);
    const lomin = Math.min(180, Math.max(-180, bbox.lomin)).toFixed(2);
    const lomax = Math.min(180, Math.max(-180, bbox.lomax)).toFixed(2);

    const url = `https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=${lamax},${lamin},${lomin},${lomax}&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0&stats=0`;

    const response = await this.fetchWithRetry(url, {}, 2);
    const data = (await response.json()) as Record<string, unknown>;

    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const results: AircraftTelemetry[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (!Array.isArray(value) || value.length < 15) continue;

      const rawHex = typeof value[0] === 'string' ? value[0].trim().toLowerCase() : '';
      const icao24 = rawHex || key.toLowerCase();
      const lat = typeof value[1] === 'number' ? value[1] : null;
      const lon = typeof value[2] === 'number' ? value[2] : null;
      if (!icao24 || lat === null || lon === null) continue;

      const track = typeof value[3] === 'number' ? value[3] : 0;
      const altFt = typeof value[4] === 'number' ? value[4] : 0;
      const gsKnots = typeof value[5] === 'number' ? value[5] : 0;
      const rawSquawk = typeof value[6] === 'string' && value[6].trim() ? value[6].trim() : null;
      const acType = typeof value[8] === 'string' ? value[8].trim() : '';
      const reg = typeof value[9] === 'string' ? value[9].trim() : '';
      const timestampSec = typeof value[10] === 'number' ? value[10] : nowSec;
      const origIata = typeof value[11] === 'string' ? value[11].trim() : '';
      const destIata = typeof value[12] === 'string' ? value[12].trim() : '';
      const flightIata = typeof value[13] === 'string' ? value[13].trim() : '';
      const onGround = Boolean(value[14]);
      const vRateFpm = typeof value[15] === 'number' ? value[15] : 0;
      const callsignIcao = typeof value[16] === 'string' ? value[16].trim() : '';

      const callsign = callsignIcao || flightIata || reg || icao24.toUpperCase();
      const routeTag =
        origIata && destIata
          ? `${origIata}→${destIata}`
          : acType || '';
      const country = inferCountryFromRegOrHex(reg, icao24, callsign);
      const originLabel = routeTag ? `${country} (${routeTag})` : country;

      const modelInfo = resolveAircraftModelInfo(acType);

      const baroMeters = Math.max(0, Math.round(altFt * 0.3048));
      const geoMeters = baroMeters > 0 ? baroMeters + 115 : 0;
      const squawk = this.squawkOverrides.get(icao24) ?? (rawSquawk || '1200');

      results.push({
        icao24,
        callsign,
        origin_country: originLabel,
        lat,
        lon,
        baro_altitude: baroMeters,
        geo_altitude: geoMeters,
        velocity: Number((gsKnots * 0.514444).toFixed(1)),
        true_track: ((track % 360) + 360) % 360,
        vertical_rate: Number((vRateFpm * 0.00508).toFixed(2)),
        squawk,
        on_ground: onGround,
        last_contact: timestampSec,
        geohash: encodeGeohash(lat, lon, CONFIG.SPATIAL_GEOHASH_PRECISION),
        fir: classifyChileanFIR(lat, lon),
        source: 'adsbfi',
        server_timestamp: now,
        registration: reg || undefined,
        aircraft_code: modelInfo.code,
        aircraft_model: modelInfo.model,
      });
    }

    return results;
  }

  /**
   * 3. Queries OpenSky Network `/states/all` for the target BoundingBox when quota is available.
   */
  private async fetchOpenSky(bbox: BoundingBox): Promise<AircraftTelemetry[]> {
    if (Date.now() < this.openSkyCooldownUntil) {
      return [];
    }

    const isGlobal =
      bbox.lamax - bbox.lamin > 140 && bbox.lomax - bbox.lomin > 300;

    const params = new URLSearchParams();
    if (!isGlobal) {
      params.set('lamin', bbox.lamin.toFixed(2));
      params.set('lomin', bbox.lomin.toFixed(2));
      params.set('lamax', bbox.lamax.toFixed(2));
      params.set('lomax', bbox.lomax.toFixed(2));
    }

    const url = params.toString()
      ? `${CONFIG.OPENSKY_BASE_URL}?${params.toString()}`
      : CONFIG.OPENSKY_BASE_URL;

    const headers: Record<string, string> = {};
    if (CONFIG.OPENSKY_USERNAME && CONFIG.OPENSKY_PASSWORD) {
      const credentials = Buffer.from(
        `${CONFIG.OPENSKY_USERNAME}:${CONFIG.OPENSKY_PASSWORD}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    try {
      const response = await this.fetchWithRetry(url, headers, 1);
      const remaining = response.headers.get('X-Rate-Limit-Remaining');
      if (remaining !== null) {
        telemetryStore.updateRemainingQuota(Number(remaining));
      }

      const data = (await response.json()) as {
        time?: number;
        states?: Array<Array<string | number | boolean | null>>;
      };

      if (!data.states || !Array.isArray(data.states)) {
        return [];
      }

      const now = Date.now();
      const normalized: AircraftTelemetry[] = [];

      for (const tuple of data.states) {
        const icao24 = typeof tuple[0] === 'string' ? tuple[0].trim().toLowerCase() : '';
        const lon = typeof tuple[5] === 'number' ? tuple[5] : null;
        const lat = typeof tuple[6] === 'number' ? tuple[6] : null;

        if (!icao24 || lat === null || lon === null) continue;

        const rawCallsign = typeof tuple[1] === 'string' ? tuple[1].trim() : '';
        const originCountry = typeof tuple[2] === 'string' ? tuple[2] : 'Unknown';
        const lastContact = typeof tuple[4] === 'number' ? tuple[4] : Math.floor(now / 1000);
        const baroAlt = typeof tuple[7] === 'number' ? tuple[7] : 0;
        const onGround = Boolean(tuple[8]);
        const velocity = typeof tuple[9] === 'number' ? tuple[9] : 0;
        const trueTrack = typeof tuple[10] === 'number' ? tuple[10] : 0;
        const verticalRate = typeof tuple[11] === 'number' ? tuple[11] : 0;
        const geoAlt = typeof tuple[13] === 'number' ? tuple[13] : baroAlt;
        const rawSquawk = typeof tuple[14] === 'string' && tuple[14].trim() ? tuple[14].trim() : null;
        const squawk = this.squawkOverrides.get(icao24) ?? rawSquawk;

        if (isPointInBbox(lat, lon, bbox)) {
          normalized.push({
            icao24,
            callsign: rawCallsign || icao24.toUpperCase(),
            origin_country: originCountry,
            lat,
            lon,
            baro_altitude: Math.max(0, baroAlt),
            geo_altitude: Math.max(0, geoAlt),
            velocity: Math.max(0, velocity),
            true_track: ((trueTrack % 360) + 360) % 360,
            vertical_rate: verticalRate,
            squawk,
            on_ground: onGround,
            last_contact: lastContact,
            geohash: encodeGeohash(lat, lon, CONFIG.SPATIAL_GEOHASH_PRECISION),
            fir: classifyChileanFIR(lat, lon),
            source: 'opensky',
            server_timestamp: now,
          });
        }
      }

      return normalized;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        this.openSkyCooldownUntil = Date.now() + 60_000;
      }
      return [];
    }
  }

  /**
   * Executes live multi-feed ADS-B ingestion for the requested BoundingBox.
   */
  public async ingestTelemetry(bbox: BoundingBox): Promise<{
    aircraft: AircraftTelemetry[];
    source: 'opensky' | 'adsbfi' | 'hybrid' | 'synthetic';
  }> {
    const [adsbFiList, liveBboxList, openSkyList] = await Promise.all([
      this.fetchAdsbFi(bbox).catch(() => [] as AircraftTelemetry[]),
      this.fetchLiveBboxFeed(bbox).catch(() => [] as AircraftTelemetry[]),
      this.fetchOpenSky(bbox).catch(() => [] as AircraftTelemetry[]),
    ]);

    const mergedReal = new Map<string, AircraftTelemetry>();

    for (const ac of liveBboxList) {
      mergedReal.set(ac.icao24, ac);
    }

    for (const ac of adsbFiList) {
      const existing = mergedReal.get(ac.icao24);
      mergedReal.set(ac.icao24, {
        ...ac,
        origin_country: existing?.origin_country.includes('→')
          ? existing.origin_country
          : ac.origin_country,
        aircraft_model: ac.aircraft_model || existing?.aircraft_model,
        aircraft_code: ac.aircraft_code || existing?.aircraft_code,
        registration: ac.registration || existing?.registration,
      });
    }

    for (const ac of openSkyList) {
      if (!mergedReal.has(ac.icao24)) {
        mergedReal.set(ac.icao24, ac);
      }
    }

    const finalList = Array.from(mergedReal.values());
    const primarySource: 'opensky' | 'adsbfi' =
      openSkyList.length > 0 && adsbFiList.length === 0 && liveBboxList.length === 0
        ? 'opensky'
        : 'adsbfi';

    return {
      aircraft: finalList,
      source: primarySource,
    };
  }
}

export const adsbClient = new ADSBClient();
