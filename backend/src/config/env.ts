import dotenv from 'dotenv';
import { BoundingBox, FIRDefinition } from '../types/telemetry.js';

dotenv.config({ path: '../.env' });
dotenv.config();

export const CONFIG = {
  PORT: Number(process.env.PORT || 4000),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX || 'aerotrack:',
  STATE_TTL_SECONDS: Number(process.env.STATE_TTL_SECONDS || 120),
  TRAIL_MAX_POINTS: Number(process.env.TRAIL_MAX_POINTS || 150),

  OPENSKY_BASE_URL: process.env.OPENSKY_BASE_URL || 'https://opensky-network.org/api/states/all',
  OPENSKY_USERNAME: process.env.OPENSKY_USERNAME || '',
  OPENSKY_PASSWORD: process.env.OPENSKY_PASSWORD || '',
  ADSBFI_BASE_URL: process.env.ADSBFI_BASE_URL || 'https://opendata.adsb.fi/api/v2',

  POLLING_INTERVAL_MS: Math.min(10000, Math.max(5000, Number(process.env.POLLING_INTERVAL_MS || 6000))),
  HTTP_TIMEOUT_MS: Number(process.env.HTTP_TIMEOUT_MS || 5000),
  MAX_HTTP_RETRIES: Number(process.env.MAX_HTTP_RETRIES || 3),

  ENABLE_HYBRID_SYNTHETIC_TRAFFIC: process.env.ENABLE_HYBRID_SYNTHETIC_TRAFFIC === 'true',
  SYNTHETIC_AIRCRAFT_COUNT: Number(process.env.SYNTHETIC_AIRCRAFT_COUNT || 0),

  /**
   * Default Chilean Airspace Bounding Box:
   * Covers Continental Chile, Juan Fernandez Archipelago & Rapa Nui
   */
  CHILE_DEFAULT_BBOX: {
    lamin: Number(process.env.DEFAULT_LAMIN ?? -56.5),
    lomin: Number(process.env.DEFAULT_LOMIN ?? -109.5),
    lamax: Number(process.env.DEFAULT_LAMAX ?? -17.5),
    lomax: Number(process.env.DEFAULT_LOMAX ?? -66.0),
  } as BoundingBox,

  SPATIAL_GEOHASH_PRECISION: Math.min(6, Math.max(4, Number(process.env.SPATIAL_GEOHASH_PRECISION || 4))),
};

/**
 * DGAC Chile Flight Information Regions (FIRs):
 * Convergence of SCFA, SCEZ, SCTE, SCCF, and SCIP Oceanic
 */
export const CHILE_FIRS: FIRDefinition[] = [
  {
    code: 'SCFA',
    name: 'FIR Antofagasta (Norte Grande)',
    center: [-70.399, -23.444],
    bbox: { lamin: -28.0, lomin: -90.0, lamax: -17.5, lomax: -66.5 },
    polygon: [
      [-90.0, -17.5],
      [-66.5, -17.5],
      [-66.5, -28.0],
      [-90.0, -28.0],
      [-90.0, -17.5],
    ],
    color: '#06b6d4', // cyan-500
  },
  {
    code: 'SCEZ',
    name: 'FIR Santiago (Central & Juan Fernández)',
    center: [-70.785, -33.393],
    bbox: { lamin: -38.5, lomin: -90.0, lamax: -28.0, lomax: -69.5 },
    polygon: [
      [-90.0, -28.0],
      [-69.5, -28.0],
      [-70.8, -38.5],
      [-90.0, -38.5],
      [-90.0, -28.0],
    ],
    color: '#3b82f6', // blue-500
  },
  {
    code: 'SCTE',
    name: 'FIR Puerto Montt (Sur & Chiloé)',
    center: [-73.094, -41.438],
    bbox: { lamin: -47.0, lomin: -90.0, lamax: -38.5, lomax: -71.0 },
    polygon: [
      [-90.0, -38.5],
      [-70.8, -38.5],
      [-71.5, -47.0],
      [-90.0, -47.0],
      [-90.0, -38.5],
    ],
    color: '#10b981', // emerald-500
  },
  {
    code: 'SCCF',
    name: 'FIR Punta Arenas (Austral & Magallanes)',
    center: [-70.854, -53.002],
    bbox: { lamin: -56.5, lomin: -90.0, lamax: -47.0, lomax: -66.0 },
    polygon: [
      [-90.0, -47.0],
      [-71.5, -47.0],
      [-66.0, -55.0],
      [-66.0, -56.5],
      [-90.0, -56.5],
      [-90.0, -47.0],
    ],
    color: '#8b5cf6', // violet-500
  },
  {
    code: 'SCIP',
    name: 'FIR Isla de Pascua (Rapa Nui Oceánico)',
    center: [-109.421, -27.164],
    bbox: { lamin: -42.0, lomin: -115.0, lamax: -17.5, lomax: -90.0 },
    polygon: [
      [-115.0, -17.5],
      [-90.0, -17.5],
      [-90.0, -42.0],
      [-115.0, -42.0],
      [-115.0, -17.5],
    ],
    color: '#f59e0b', // amber-500
  },
];
