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

/**
 * Normalized ADS-B Telemetry frame conforming to the core contract:
 * { icao24, callsign, origin_country, lat, lon, baro_altitude, velocity, true_track, vertical_rate, squawk, on_ground, last_contact }
 * enriched with geometric altitude, spatial geohash cell, and FIR classification.
 */
export interface AircraftTelemetry {
  icao24: string;
  callsign: string;
  origin_country: string;
  lat: number;
  lon: number;
  baro_altitude: number; // meters
  geo_altitude: number; // meters
  velocity: number; // m/s ground speed
  true_track: number; // degrees [0, 360) clockwise from true north
  vertical_rate: number; // m/s (+ climb, - descent)
  squawk: string | null; // 4-octal code ('7500', '7600', '7700', etc.)
  on_ground: boolean;
  last_contact: number; // Unix epoch seconds
  geohash: string; // Level 4-6 spatial hash
  fir: ChileanFIRCode; // Chilean FIR sector or INTL
  source: 'opensky' | 'adsbfi' | 'synthetic';
  server_timestamp: number; // Unix epoch ms
  registration?: string; // e.g., CC-BEN, N880BJ
  aircraft_code?: string; // ICAO type designator, e.g., A321, B789
  aircraft_model?: string; // Full human-readable model, e.g., Airbus A321-211SL
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

export interface FIRDefinition {
  code: ChileanFIRCode;
  name: string;
  center: [number, number]; // [lon, lat]
  bbox: BoundingBox;
  polygon: [number, number][]; // [lon, lat][]
  color: string;
}

export type ClientWSMessage =
  | {
      type: 'viewport_changed';
      bbox: BoundingBox;
      zoom: number;
    }
  | {
      type: 'subscribe_aircraft';
      icao24: string | null;
    }
  | {
      type: 'inject_emergency_test';
      icao24?: string;
      squawk: '7500' | '7600' | '7700' | '1200';
    }
  | {
      type: 'ping';
      clientTime: number;
    };

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
