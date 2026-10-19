export type ChileanFIRCode = 'SCEZ' | 'SCFA' | 'SCTE' | 'SCCF' | 'SCIP' | 'INTL';

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
}

export type AirframeCategory = 'twin-jet' | 'quad-jet' | 'turboprop';

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
 * Extended client-side kinematic entity used by the 60 FPS requestAnimationFrame
 * Dead Reckoning & Spherical Great Circle interpolation loop.
 */
export interface KinematicAircraft extends AircraftTelemetry {
  // Last authoritative telemetry anchor P_0 received via WebSocket
  anchorLat: number;
  anchorLon: number;
  anchorAlt: number;
  anchorTrack: number;
  anchorTimestampMs: number;

  // Smoothly interpolated render coordinates P_t at 60 FPS (never teleports)
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

export type ServerWSMessage =
  | {
      type: 'telemetry_batch';
      timestamp: number;
      source: 'opensky' | 'adsbfi' | 'hybrid' | 'synthetic';
      activeBbox: BoundingBox;
      geohashPrefixes: string[];
      aircraft: AircraftTelemetry[];
      removedIds: string[];
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
