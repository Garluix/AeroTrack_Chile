export type ChileanFIRCode = 'SCEZ' | 'SCFA' | 'SCTE' | 'SCCF' | 'SCIP' | 'INTL';

export type AircraftFilterType = 'all' | 'planes' | 'helicopters';

export interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export interface TrailBreadcrumb {
  lat: number;
  lon: number;
  alt: number;
  velocity: number;
  track: number;
  timestamp: number;
}

export interface AircraftTelemetry {
  icao24: string;
  callsign: string;
  origin_country: string;
  lat: number;
  lon: number;
  baro_altitude: number;
  geo_altitude: number;
  velocity: number;
  true_track: number;
  vertical_rate: number;
  squawk: string | null;
  on_ground: boolean;
  last_contact: number;
  geohash: string;
  fir: ChileanFIRCode;
  source: 'opensky' | 'adsbfi' | 'synthetic';
  server_timestamp: number;
  registration?: string;
  aircraft_code?: string;
  aircraft_model?: string;
  isHelicopter: boolean;
}

export type AirframeCategory = 'twin-jet' | 'quad-jet' | 'turboprop' | 'helicopter';

export interface AircraftPhotoMetadata {
  icao24: string;
  photoUrl: string | null;
  photographer: string | null;
  photoLink: string | null;
  aircraftModel: string;
  aircraftCode: string;
  registration: string;
  operator: string | null;
  category: AirframeCategory;
}

/**
 * Extended client-side kinematic entity used by the 60/120 FPS requestAnimationFrame
 * Dead Reckoning & Spherical Great Circle interpolation loop:
 *   P(t) = P_anterior + (P_objetivo(t) - P_anterior) * alpha
 */
export interface KinematicAircraft extends AircraftTelemetry {
  // Raw transponder coordinates from the last upstream packet (to detect duplicate fixes)
  rawLat: number;
  rawLon: number;

  // Last authoritative telemetry anchor P_0 received via WebSocket
  anchorLat: number;
  anchorLon: number;
  anchorAlt: number;
  anchorTrack: number;
  anchorTimestampMs: number;

  // Previous rendered coordinate P_anterior and current interpolated coordinate P(t)
  prevLat: number;
  prevLon: number;
  renderLat: number;
  renderLon: number;
  renderAlt: number;
  renderTrack: number;
}

export interface FIRDefinition {
  code: ChileanFIRCode;
  name: string;
  center: [number, number];
  bbox: BoundingBox;
  polygon: [number, number][];
  color: string;
}

export interface SystemMetrics {
  connectedClients: number;
  totalTrackedAircraft: number;
  upstreamSource: string;
  rateLimitRemaining: number;
  redisConnected: boolean;
  pollingIntervalMs: number;
  activeBbox: BoundingBox;
  wsLatencyMs: number;
  fps: number;
  activeGeohashes: string[];
}

/**
 * Compact WebSocket Wire Tuple matching backend CompactAircraftTuple:
 * [
 *   0: icao24, 1: callsign, 2: origin_country, 3: lat, 4: lon,
 *   5: baro_altitude, 6: geo_altitude, 7: velocity, 8: true_track, 9: vertical_rate,
 *   10: squawk, 11: on_ground (0 | 1), 12: last_contact, 13: geohash, 14: fir,
 *   15: registration, 16: aircraft_code, 17: aircraft_model, 18: isHelicopter
 * ]
 */
export type CompactAircraftTuple = [
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string | null,
  0 | 1,
  number,
  string,
  ChileanFIRCode,
  string,
  string,
  string,
  boolean
];

export type ServerWSMessage =
  | {
      type: 'telemetry_batch';
      timestamp: number;
      source: 'opensky' | 'adsbfi' | 'hybrid' | 'synthetic';
      activeBbox: BoundingBox;
      geohashPrefixes: string[];
      tuples?: CompactAircraftTuple[];
      aircraft?: AircraftTelemetry[];
      removedIds: string[];
      totalGlobalCount?: number;
    }
  | {
      type: 'aircraft_trail';
      icao24: string;
      trail: TrailBreadcrumb[];
    }
  | {
      type: 'system_metrics';
      connectedClients: number;
      totalTrackedAircraft: number;
      upstreamSource: string;
      rateLimitRemaining: number;
      redisConnected: boolean;
      pollingIntervalMs: number;
      activeBbox: BoundingBox;
    }
  | {
      type: 'pong';
      clientTime: number;
      serverTime: number;
    };
