import { create } from 'zustand';
import {
  AircraftFilterType,
  AircraftTelemetry,
  BoundingBox,
  ChileanFIRCode,
  CompactAircraftTuple,
  FIRDefinition,
  KinematicAircraft,
  SystemMetrics,
  TrailBreadcrumb,
} from '../types/telemetry';
import { computeMonotonicAnchorTimestamp } from '../utils/kinematics';

export interface CameraTarget {
  lat: number;
  lon: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  timestamp: number;
}

interface FlightStoreState {
  // Authoritative kinematic map mutated in-place at 60/120 FPS by useDeadReckoning (outside React state reconciliation)
  kinematicMap: Map<string, KinematicAircraft>;
  // Lightweight version counter bumped only on discrete WebSocket batch arrivals
  batchVersion: number;

  // Selected aircraft and its historical geodesic breadcrumbs
  selectedIcao24: string | null;
  selectedAircraftSnapshot: KinematicAircraft | null;
  selectedTrail: TrailBreadcrumb[];

  // Three-category tactical filter: 'all' | 'planes' | 'helicopters'
  filterType: AircraftFilterType;

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
    tuples: CompactAircraftTuple[] | undefined,
    aircraft: AircraftTelemetry[] | undefined,
    removedIds: string[],
    activeBbox: BoundingBox,
    geohashPrefixes: string[],
    source: string,
    totalGlobalCount?: number
  ) => void;
  setFilterType: (type: AircraftFilterType) => void;
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

function upsertKinematicEntity(
  map: Map<string, KinematicAircraft>,
  frame: AircraftTelemetry,
  nowMs: number
): void {
  const existing = map.get(frame.icao24);
  if (existing) {
    const posChanged =
      Math.abs(frame.lat - existing.rawLat) > 1e-5 ||
      Math.abs(frame.lon - existing.rawLon) > 1e-5;

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
    existing.isHelicopter = Boolean(frame.isHelicopter);
    if (frame.registration) existing.registration = frame.registration;
    if (frame.aircraft_code) existing.aircraft_code = frame.aircraft_code;
    if (frame.aircraft_model) existing.aircraft_model = frame.aircraft_model;

    // Only update the Dead Reckoning anchor when the transponder actually reported a NEW coordinate!
    // This prevents backward rubber-banding when cached/duplicate packets arrive.
    if (posChanged) {
      existing.rawLat = frame.lat;
      existing.rawLon = frame.lon;
      existing.anchorLat = frame.lat;
      existing.anchorLon = frame.lon;
      existing.anchorAlt = frame.baro_altitude;
      existing.anchorTrack = frame.true_track;
      existing.anchorTimestampMs = computeMonotonicAnchorTimestamp(
        existing.renderLat,
        existing.renderLon,
        frame.lat,
        frame.lon,
        frame.velocity,
        frame.true_track,
        nowMs
      );
    }
  } else {
    map.set(frame.icao24, {
      ...frame,
      isHelicopter: Boolean(frame.isHelicopter),
      rawLat: frame.lat,
      rawLon: frame.lon,
      anchorLat: frame.lat,
      anchorLon: frame.lon,
      anchorAlt: frame.baro_altitude,
      anchorTrack: frame.true_track,
      anchorTimestampMs: nowMs,
      prevLat: frame.lat,
      prevLon: frame.lon,
      renderLat: frame.lat,
      renderLon: frame.lon,
      renderAlt: frame.baro_altitude,
      renderTrack: frame.true_track,
    });
  }
}

export const useFlightStore = create<FlightStoreState>((set, get) => ({
  kinematicMap: new Map<string, KinematicAircraft>(),
  batchVersion: 0,

  selectedIcao24: null,
  selectedAircraftSnapshot: null,
  selectedTrail: [],

  filterType: 'all',

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
    upstreamSource: 'adsbfi',
    rateLimitRemaining: 400,
    redisConnected: false,
    pollingIntervalMs: 6000,
    activeBbox: DEFAULT_CHILE_BBOX,
    wsLatencyMs: 12,
    fps: 60,
    activeGeohashes: [],
  },

  ingestTelemetryBatch: (
    tuples,
    aircraft,
    removedIds,
    activeBbox,
    geohashPrefixes,
    source,
    totalGlobalCount
  ) => {
    const map = get().kinematicMap;
    const nowMs = performance.now();
    const serverNow = Date.now();
    const normalizedSource: 'opensky' | 'adsbfi' | 'synthetic' =
      source === 'opensky' ? 'opensky' : 'adsbfi';

    for (let i = 0; i < removedIds.length; i++) {
      map.delete(removedIds[i]);
    }

    // 1. Decode compact flat tuples [icao24, callsign, origin_country, lat, lon, ..., isHelicopter]
    if (tuples && tuples.length > 0) {
      for (let i = 0; i < tuples.length; i++) {
        const t = tuples[i];
        upsertKinematicEntity(
          map,
          {
            icao24: t[0],
            callsign: t[1],
            origin_country: t[2],
            lat: t[3],
            lon: t[4],
            baro_altitude: t[5],
            geo_altitude: t[6],
            velocity: t[7],
            true_track: t[8],
            vertical_rate: t[9],
            squawk: t[10],
            on_ground: t[11] === 1,
            last_contact: t[12],
            geohash: t[13],
            fir: t[14],
            source: normalizedSource,
            server_timestamp: serverNow,
            registration: t[15] || undefined,
            aircraft_code: t[16] || undefined,
            aircraft_model: t[17] || undefined,
            isHelicopter: Boolean(t[18]),
          },
          nowMs
        );
      }
    }

    // 2. Fallback support if verbose aircraft objects were sent
    if (aircraft && aircraft.length > 0) {
      for (let i = 0; i < aircraft.length; i++) {
        upsertKinematicEntity(map, aircraft[i], nowMs);
      }
    }

    const selId = get().selectedIcao24;
    const selAc = selId ? map.get(selId) ?? null : null;
    const trackedCount =
      typeof totalGlobalCount === 'number' && totalGlobalCount > map.size
        ? totalGlobalCount
        : map.size;

    set((state) => ({
      batchVersion: state.batchVersion + 1,
      selectedAircraftSnapshot: selAc ? { ...selAc } : null,
      metrics: {
        ...state.metrics,
        totalTrackedAircraft: trackedCount,
        activeBbox,
        activeGeohashes: geohashPrefixes,
        upstreamSource: source,
      },
    }));
  },

  setFilterType: (filterType) => set({ filterType }),

  setSelectedIcao24: (icao24) => {
    const normalized = icao24 ? icao24.toLowerCase() : null;
    const ac = normalized ? get().kinematicMap.get(normalized) ?? null : null;
    set({
      selectedIcao24: normalized,
      selectedAircraftSnapshot: ac ? { ...ac } : null,
      selectedTrail: normalized ? get().selectedTrail : [],
      followSelectedAircraft: normalized ? get().followSelectedAircraft : false,
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
  setActiveFIRFilter: (activeFIRFilter) =>
    set({ activeFIRFilter, followSelectedAircraft: false }),
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
