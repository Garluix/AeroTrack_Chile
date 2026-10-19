import { create } from 'zustand';
import {
  AircraftTelemetry,
  BoundingBox,
  ChileanFIRCode,
  FIRDefinition,
  KinematicAircraft,
  SystemMetrics,
  TrailBreadcrumb,
} from '../types/telemetry';

export interface CameraTarget {
  lat: number;
  lon: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  timestamp: number;
}

interface FlightStoreState {
  // Authoritative kinematic map mutated in-place at 60 FPS by useDeadReckoning
  kinematicMap: Map<string, KinematicAircraft>;
  // Lightweight version counter bumped only on discrete WebSocket batch arrivals
  batchVersion: number;

  // Selected aircraft and its historical geodesic breadcrumbs
  selectedIcao24: string | null;
  selectedAircraftSnapshot: KinematicAircraft | null;
  selectedTrail: TrailBreadcrumb[];

  // FIR sector definitions & visibility
  firs: FIRDefinition[];
  showFIRBoundaries: boolean;
  activeFIRFilter: ChileanFIRCode | 'ALL';
  searchQuery: string;
  followSelectedAircraft: boolean;

  // Camera navigation target
  cameraTarget: CameraTarget | null;

  // Connection & system metrics
  wsConnected: boolean;
  metrics: SystemMetrics;

  // Actions
  ingestTelemetryBatch: (
    aircraft: AircraftTelemetry[],
    removedIds: string[],
    activeBbox: BoundingBox,
    geohashPrefixes: string[],
    source: string
  ) => void;
  setSelectedIcao24: (icao24: string | null) => void;
  syncSelectedSnapshot: () => void;
  setSelectedTrail: (icao24: string, trail: TrailBreadcrumb[]) => void;
  setFirs: (firs: FIRDefinition[]) => void;
  setShowFIRBoundaries: (show: boolean) => void;
  setActiveFIRFilter: (fir: ChileanFIRCode | 'ALL') => void;
  setSearchQuery: (query: string) => void;
  setFollowSelectedAircraft: (follow: boolean) => void;
  flyTo: (target: Omit<CameraTarget, 'timestamp'>) => void;
  setWsConnected: (connected: boolean) => void;
  updateSystemMetrics: (partial: Partial<SystemMetrics>) => void;
}

const DEFAULT_CHILE_BBOX: BoundingBox = {
  lamin: -56.5,
  lomin: -109.5,
  lamax: -17.5,
  lomax: -66.0,
};

export const useFlightStore = create<FlightStoreState>((set, get) => ({
  kinematicMap: new Map<string, KinematicAircraft>(),
  batchVersion: 0,

  selectedIcao24: null,
  selectedAircraftSnapshot: null,
  selectedTrail: [],

  firs: [],
  showFIRBoundaries: true,
  activeFIRFilter: 'ALL',
  searchQuery: '',
  followSelectedAircraft: false,

  cameraTarget: null,

  wsConnected: false,
  metrics: {
    connectedClients: 1,
    totalTrackedAircraft: 0,
    upstreamSource: 'hybrid',
    rateLimitRemaining: 400,
    redisConnected: false,
    pollingIntervalMs: 6000,
    activeBbox: DEFAULT_CHILE_BBOX,
    wsLatencyMs: 12,
    fps: 60,
    activeGeohashes: [],
  },

  ingestTelemetryBatch: (aircraft, removedIds, activeBbox, geohashPrefixes, source) => {
    const map = get().kinematicMap;
    const nowMs = performance.now();

    for (const id of removedIds) {
      map.delete(id);
    }

    for (const frame of aircraft) {
      const existing = map.get(frame.icao24);
      if (existing) {
        // Update authoritative anchor P_0 while preserving current renderLat/renderLon
        // so exponential Dead Reckoning smoothly converges without teleportation!
        existing.callsign = frame.callsign;
        existing.origin_country = frame.origin_country;
        existing.lat = frame.lat;
        existing.lon = frame.lon;
        existing.baro_altitude = frame.baro_altitude;
        existing.geo_altitude = frame.geo_altitude;
        existing.velocity = frame.velocity;
        existing.true_track = frame.true_track;
        existing.vertical_rate = frame.vertical_rate;
        existing.squawk = frame.squawk;
        existing.on_ground = frame.on_ground;
        existing.last_contact = frame.last_contact;
        existing.geohash = frame.geohash;
        existing.fir = frame.fir;
        existing.source = frame.source;
        existing.server_timestamp = frame.server_timestamp;
        existing.registration = frame.registration || existing.registration;
        existing.aircraft_code = frame.aircraft_code || existing.aircraft_code;
        existing.aircraft_model = frame.aircraft_model || existing.aircraft_model;

        existing.anchorLat = frame.lat;
        existing.anchorLon = frame.lon;
        existing.anchorAlt = frame.baro_altitude;
        existing.anchorTrack = frame.true_track;
        existing.anchorTimestampMs = nowMs;
      } else {
        map.set(frame.icao24, {
          ...frame,
          anchorLat: frame.lat,
          anchorLon: frame.lon,
          anchorAlt: frame.baro_altitude,
          anchorTrack: frame.true_track,
          anchorTimestampMs: nowMs,
          renderLat: frame.lat,
          renderLon: frame.lon,
          renderAlt: frame.baro_altitude,
          renderTrack: frame.true_track,
        });
      }
    }

    const selId = get().selectedIcao24;
    const selAc = selId ? map.get(selId) ?? null : null;

    set((state) => ({
      batchVersion: state.batchVersion + 1,
      selectedAircraftSnapshot: selAc ? { ...selAc } : null,
      metrics: {
        ...state.metrics,
        totalTrackedAircraft: map.size,
        activeBbox,
        activeGeohashes: geohashPrefixes,
        upstreamSource: source,
      },
    }));
  },

  setSelectedIcao24: (icao24) => {
    const normalized = icao24 ? icao24.toLowerCase() : null;
    const ac = normalized ? get().kinematicMap.get(normalized) ?? null : null;
    set({
      selectedIcao24: normalized,
      selectedAircraftSnapshot: ac ? { ...ac } : null,
      selectedTrail: normalized ? get().selectedTrail : [],
    });
  },

  syncSelectedSnapshot: () => {
    const selId = get().selectedIcao24;
    if (!selId) return;
    const ac = get().kinematicMap.get(selId);
    if (ac) {
      set({ selectedAircraftSnapshot: { ...ac } });
    }
  },

  setSelectedTrail: (icao24, trail) => {
    if (get().selectedIcao24 === icao24.toLowerCase()) {
      set({ selectedTrail: trail });
    }
  },

  setFirs: (firs) => set({ firs }),
  setShowFIRBoundaries: (showFIRBoundaries) => set({ showFIRBoundaries }),
  setActiveFIRFilter: (activeFIRFilter) => set({ activeFIRFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFollowSelectedAircraft: (followSelectedAircraft) => set({ followSelectedAircraft }),
  flyTo: (target) => set({ cameraTarget: { ...target, timestamp: Date.now() } }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  updateSystemMetrics: (partial) =>
    set((state) => ({
      metrics: {
        ...state.metrics,
        ...partial,
      },
    })),
}));
