import { create } from 'zustand';
import {
  AircraftCategoryCounts,
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
import {
  computeMonotonicAnchorTimestamp,
  isEmergencySquawk,
  isHelicopterAirframe,
  updatePrecomputedVelocity,
} from '../utils/kinematics';

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
  // Precomputed category counts & emergency list updated once per batch in a single pass
  categoryCounts: AircraftCategoryCounts;
  emergencyList: KinematicAircraft[];

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

function buildSearchKey(
  callsign: string,
  icao24: string,
  squawk: string | null,
  originCountry: string
): string {
  return `${callsign} ${icao24} ${squawk ?? ''} ${originCountry}`.toLowerCase();
}

/**
 * Zero-allocation tuple upsert: mutates existing KinematicAircraft entries in-place
 * directly from the flat WebSocket wire tuple without creating temporary intermediate objects.
 */
function upsertCompactTuple(
  map: Map<string, KinematicAircraft>,
  t: CompactAircraftTuple,
  normalizedSource: 'opensky' | 'adsbfi' | 'synthetic',
  serverNow: number,
  nowMs: number
): void {
  const icao24 = t[0];
  const callsign = t[1];
  const originCountry = t[2];
  const lat = t[3];
  const lon = t[4];
  const baroAlt = t[5];
  const geoAlt = t[6];
  const velocity = t[7];
  const trueTrack = t[8];
  const verticalRate = t[9];
  const squawk = t[10];
  const onGround = t[11] === 1;
  const lastContact = t[12];
  const geohash = t[13];
  const fir = t[14];
  const registration = t[15] || undefined;
  const aircraftCode = t[16] || undefined;
  const aircraftModel = t[17] || undefined;
  const isHeli = Boolean(t[18]) || isHelicopterAirframe(aircraftCode, aircraftModel);

  const existing = map.get(icao24);
  if (existing) {
    const posChanged =
      Math.abs(lat - existing.rawLat) > 1e-5 ||
      Math.abs(lon - existing.rawLon) > 1e-5;
    const searchChanged =
      existing.callsign !== callsign ||
      existing.squawk !== squawk ||
      existing.origin_country !== originCountry;

    existing.callsign = callsign;
    existing.origin_country = originCountry;
    existing.lat = lat;
    existing.lon = lon;
    existing.baro_altitude = baroAlt;
    existing.geo_altitude = geoAlt;
    existing.velocity = velocity;
    existing.true_track = trueTrack;
    existing.vertical_rate = verticalRate;
    existing.squawk = squawk;
    existing.on_ground = onGround;
    existing.last_contact = lastContact;
    existing.geohash = geohash;
    existing.fir = fir;
    existing.source = normalizedSource;
    existing.server_timestamp = serverNow;
    existing.isHelicopter = isHeli;
    if (registration) existing.registration = registration;
    if (aircraftCode) existing.aircraft_code = aircraftCode;
    if (aircraftModel) existing.aircraft_model = aircraftModel;

    if (searchChanged || !existing.searchKey) {
      existing.searchKey = buildSearchKey(callsign, icao24, squawk, originCountry);
    }

    if (posChanged) {
      existing.rawLat = lat;
      existing.rawLon = lon;
      existing.anchorLat = lat;
      existing.anchorLon = lon;
      existing.anchorAlt = baroAlt;
      existing.anchorTrack = trueTrack;
      existing.anchorTimestampMs = computeMonotonicAnchorTimestamp(
        existing.renderLat,
        existing.renderLon,
        lat,
        lon,
        velocity,
        trueTrack,
        nowMs
      );
    }
    updatePrecomputedVelocity(existing);
  } else {
    const created: KinematicAircraft = {
      icao24,
      callsign,
      origin_country: originCountry,
      lat,
      lon,
      baro_altitude: baroAlt,
      geo_altitude: geoAlt,
      velocity,
      true_track: trueTrack,
      vertical_rate: verticalRate,
      squawk,
      on_ground: onGround,
      last_contact: lastContact,
      geohash,
      fir,
      source: normalizedSource,
      server_timestamp: serverNow,
      registration,
      aircraft_code: aircraftCode,
      aircraft_model: aircraftModel,
      isHelicopter: isHeli,
      rawLat: lat,
      rawLon: lon,
      anchorLat: lat,
      anchorLon: lon,
      anchorAlt: baroAlt,
      anchorTrack: trueTrack,
      anchorTimestampMs: nowMs,
      prevLat: lat,
      prevLon: lon,
      renderLat: lat,
      renderLon: lon,
      renderAlt: baroAlt,
      renderTrack: trueTrack,
      searchKey: buildSearchKey(callsign, icao24, squawk, originCountry),
    };
    updatePrecomputedVelocity(created);
    map.set(icao24, created);
  }
}

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
    const searchChanged =
      existing.callsign !== frame.callsign ||
      existing.squawk !== frame.squawk ||
      existing.origin_country !== frame.origin_country;

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
    existing.isHelicopter =
      Boolean(frame.isHelicopter) ||
      isHelicopterAirframe(frame.aircraft_code, frame.aircraft_model);
    if (frame.registration) existing.registration = frame.registration;
    if (frame.aircraft_code) existing.aircraft_code = frame.aircraft_code;
    if (frame.aircraft_model) existing.aircraft_model = frame.aircraft_model;

    if (searchChanged || !existing.searchKey) {
      existing.searchKey = buildSearchKey(
        frame.callsign,
        frame.icao24,
        frame.squawk,
        frame.origin_country
      );
    }

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
    updatePrecomputedVelocity(existing);
  } else {
    const created: KinematicAircraft = {
      ...frame,
      isHelicopter:
        Boolean(frame.isHelicopter) ||
        isHelicopterAirframe(frame.aircraft_code, frame.aircraft_model),
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
      searchKey: buildSearchKey(
        frame.callsign,
        frame.icao24,
        frame.squawk,
        frame.origin_country
      ),
    };
    updatePrecomputedVelocity(created);
    map.set(frame.icao24, created);
  }
}

function summarizeKinematicMap(
  map: Map<string, KinematicAircraft>,
  totalGlobalCount?: number
): { categoryCounts: AircraftCategoryCounts; emergencyList: KinematicAircraft[] } {
  let all = 0;
  let planes = 0;
  let helicopters = 0;
  const emergencyList: KinematicAircraft[] = [];

  for (const ac of map.values()) {
    all++;
    if (ac.isHelicopter === true) {
      helicopters++;
    } else {
      planes++;
    }
    if (isEmergencySquawk(ac.squawk)) {
      emergencyList.push(ac);
    }
  }

  if (typeof totalGlobalCount === 'number' && totalGlobalCount > all) {
    const delta = totalGlobalCount - all;
    all += delta;
    planes += delta;
  }

  return {
    categoryCounts: { all, planes, helicopters },
    emergencyList,
  };
}

export const useFlightStore = create<FlightStoreState>((set, get) => ({
  kinematicMap: new Map<string, KinematicAircraft>(),
  batchVersion: 0,
  categoryCounts: { all: 0, planes: 0, helicopters: 0 },
  emergencyList: [],

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
      source === 'opensky' ? 'opensky' : source === 'synthetic' ? 'synthetic' : 'adsbfi';

    for (let i = 0; i < removedIds.length; i++) {
      map.delete(removedIds[i]);
    }

    // 1. Decode compact flat tuples directly in-place without intermediate object allocations
    if (tuples && tuples.length > 0) {
      for (let i = 0; i < tuples.length; i++) {
        upsertCompactTuple(map, tuples[i], normalizedSource, serverNow, nowMs);
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

    const { categoryCounts, emergencyList } = summarizeKinematicMap(map, trackedCount);

    set((state) => ({
      batchVersion: state.batchVersion + 1,
      categoryCounts,
      emergencyList,
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
    const state = get();
    const map = state.kinematicMap;
    const selId = state.selectedIcao24;
    const ac = selId ? map.get(selId) : undefined;
    const { categoryCounts, emergencyList } = summarizeKinematicMap(
      map,
      state.metrics.totalTrackedAircraft
    );
    set({
      categoryCounts,
      emergencyList,
      ...(ac ? { selectedAircraftSnapshot: { ...ac } } : {}),
    });
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
