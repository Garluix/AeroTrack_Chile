import type { WebSocket } from 'ws';
import { CONFIG } from '../config/env.js';
import {
  getBboxGeohashPrefixes,
  isBboxContainedIn,
  isPointInBbox,
  mergeBoundingBoxes,
} from '../spatial/geohash.js';
import {
  AircraftTelemetry,
  BoundingBox,
  ClientWSMessage,
  CompactAircraftTuple,
  ServerWSMessage,
} from '../types/telemetry.js';
import { telemetryStore } from '../cache/redisStore.js';
import { adsbClient } from '../services/adsbClient.js';
import { telemetryPoller } from '../workers/telemetryPoller.js';

interface ClientSession {
  id: string;
  socket: WebSocket;
  bbox: BoundingBox;
  zoom: number;
  geohashPrefixes: string[];
  selectedIcao24: string | null;
  hasReceivedFullCatalog: boolean;
}

function toCompactTuple(ac: AircraftTelemetry): CompactAircraftTuple {
  return [
    ac.icao24,
    ac.callsign,
    ac.origin_country,
    ac.lat,
    ac.lon,
    ac.baro_altitude,
    ac.geo_altitude,
    ac.velocity,
    ac.true_track,
    ac.vertical_rate,
    ac.squawk,
    ac.on_ground ? 1 : 0,
    ac.last_contact,
    ac.geohash,
    ac.fir,
    ac.registration || '',
    ac.aircraft_code || '',
    ac.aircraft_model || '',
    Boolean(ac.isHelicopter),
  ];
}

export class TelemetryWebSocketBroker {
  private sessions = new Map<string, ClientSession>();
  private lastUpstreamSource: 'opensky' | 'adsbfi' | 'hybrid' | 'synthetic' = 'adsbfi';

  public registerClient(id: string, socket: WebSocket): void {
    const initialBbox = { ...CONFIG.CHILE_DEFAULT_BBOX };
    const session: ClientSession = {
      id,
      socket,
      bbox: initialBbox,
      zoom: 6.0,
      geohashPrefixes: getBboxGeohashPrefixes(initialBbox, CONFIG.SPATIAL_GEOHASH_PRECISION),
      selectedIcao24: null,
      hasReceivedFullCatalog: false,
    };

    this.sessions.set(id, session);

    // Immediately dispatch initial cached snapshot for client's viewport
    this.sendSnapshotToSession(session);

    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientWSMessage;
        this.handleClientMessage(session, msg);
      } catch {
        // Ignore malformed client payloads
      }
    });

    socket.on('close', () => {
      this.sessions.delete(id);
    });

    socket.on('error', () => {
      this.sessions.delete(id);
    });
  }

  private handleClientMessage(session: ClientSession, msg: ClientWSMessage): void {
    switch (msg.type) {
      case 'viewport_changed': {
        const { bbox, zoom } = msg;
        if (
          typeof bbox?.lamin === 'number' &&
          typeof bbox?.lomin === 'number' &&
          typeof bbox?.lamax === 'number' &&
          typeof bbox?.lomax === 'number'
        ) {
          session.bbox = {
            lamin: Math.max(-85, Math.min(85, bbox.lamin)),
            lomin: Math.max(-180, Math.min(180, bbox.lomin)),
            lamax: Math.max(-85, Math.min(85, bbox.lamax)),
            lomax: Math.max(-180, Math.min(180, bbox.lomax)),
          };
          session.zoom = typeof zoom === 'number' ? zoom : session.zoom;
          session.geohashPrefixes = getBboxGeohashPrefixes(
            session.bbox,
            CONFIG.SPATIAL_GEOHASH_PRECISION
          );
          this.sendSnapshotToSession(session);
          if (!isBboxContainedIn(session.bbox, CONFIG.CHILE_DEFAULT_BBOX)) {
            telemetryPoller.triggerOnDemandPoll();
          }
        }
        break;
      }

      case 'subscribe_aircraft': {
        session.selectedIcao24 = msg.icao24 ? msg.icao24.toLowerCase() : null;
        if (session.selectedIcao24) {
          const trail = telemetryStore.getTrail(session.selectedIcao24);
          this.sendToSession(session, {
            type: 'aircraft_trail',
            icao24: session.selectedIcao24,
            trail,
          });
        }
        break;
      }

      case 'inject_emergency_test': {
        const targetIcao = adsbClient.setAircraftSquawk(msg.icao24, msg.squawk);
        if (targetIcao) {
          const existing = telemetryStore.getAircraft(targetIcao);
          if (existing) {
            existing.squawk = msg.squawk;
          }
        }
        break;
      }

      case 'ping': {
        this.sendToSession(session, {
          type: 'pong',
          clientTime: msg.clientTime,
          serverTime: Date.now(),
        });
        break;
      }
    }
  }

  /**
   * Computes the effective query BoundingBox across all active clients.
   */
  public getEffectiveQueryBbox(): BoundingBox {
    if (this.sessions.size === 0) {
      return { ...CONFIG.CHILE_DEFAULT_BBOX };
    }

    const boxes: BoundingBox[] = [{ ...CONFIG.CHILE_DEFAULT_BBOX }];
    for (const session of this.sessions.values()) {
      if (!isBboxContainedIn(session.bbox, CONFIG.CHILE_DEFAULT_BBOX)) {
        boxes.push(session.bbox);
      }
    }

    if (boxes.length === 1) {
      return boxes[0];
    }

    return mergeBoundingBoxes(boxes);
  }

  public getConnectedClientCount(): number {
    return this.sessions.size;
  }

  public setLastUpstreamSource(source: 'opensky' | 'adsbfi' | 'hybrid' | 'synthetic'): void {
    this.lastUpstreamSource = source;
  }

  public getLastUpstreamSource(): string {
    return this.lastUpstreamSource;
  }

  /**
   * Serializes the full active aircraft set or dynamic viewport subset into compact flat tuples
   * with ZERO artificial caps (supports 10,000 - 15,000+ simultaneous global aircraft).
   */
  private filterForSessionViewport(
    candidates: AircraftTelemetry[],
    session: ClientSession
  ): CompactAircraftTuple[] {
    const latSpan = Math.abs(session.bbox.lamax - session.bbox.lamin);
    const lonSpan = Math.abs(session.bbox.lomax - session.bbox.lomin);
    const isContinentalOrGlobalView =
      !session.hasReceivedFullCatalog ||
      session.zoom <= 5.8 ||
      latSpan > 25 ||
      lonSpan > 35;

    // When viewing a country/continent (e.g. United States, South America, or Global view)
    // or hydrating the initial global catalog, transmit the entire global catalog without any slice or limit!
    if (isContinentalOrGlobalView) {
      if (candidates.length > 500) {
        session.hasReceivedFullCatalog = true;
      }
      const tuples = new Array<CompactAircraftTuple>(candidates.length);
      for (let i = 0; i < candidates.length; i++) {
        tuples[i] = toCompactTuple(candidates[i]);
      }
      return tuples;
    }

    const padDeg = 12.0;
    const paddedBbox: BoundingBox = {
      lamin: Math.max(-85, session.bbox.lamin - padDeg),
      lomin: Math.max(-180, session.bbox.lomin - padDeg),
      lamax: Math.min(85, session.bbox.lamax + padDeg),
      lomax: Math.min(180, session.bbox.lomax + padDeg),
    };

    const filtered: AircraftTelemetry[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const ac = candidates[i];
      if (
        ac.icao24 === session.selectedIcao24 ||
        ac.fir !== 'INTL' ||
        ac.squawk === '7500' ||
        ac.squawk === '7600' ||
        ac.squawk === '7700' ||
        isPointInBbox(ac.lat, ac.lon, paddedBbox)
      ) {
        filtered.push(ac);
      }
    }

    const tuples = new Array<CompactAircraftTuple>(filtered.length);
    for (let i = 0; i < filtered.length; i++) {
      tuples[i] = toCompactTuple(filtered[i]);
    }
    return tuples;
  }

  /**
   * Sends the full initial global catalog snapshot to a newly connected or panning client session
   * so all 10,000+ aircraft across the US, Europe, Asia, and Chile are immediately available in client memory.
   */
  private sendSnapshotToSession(session: ClientSession): void {
    const all = telemetryStore.getAllAircraft();
    if (all.length > 500) {
      session.hasReceivedFullCatalog = true;
    }
    const tuples = new Array<CompactAircraftTuple>(all.length);
    for (let i = 0; i < all.length; i++) {
      tuples[i] = toCompactTuple(all[i]);
    }

    this.sendToSession(session, {
      type: 'telemetry_batch',
      timestamp: Date.now(),
      source: this.lastUpstreamSource,
      activeBbox: this.getEffectiveQueryBbox(),
      geohashPrefixes: session.geohashPrefixes,
      tuples,
      removedIds: [],
      totalGlobalCount: all.length,
    });
  }

  /**
   * Broadcasts updated aircraft frames as compact flat tuples and system metrics to all connected clients,
   * segmented by each client's spatial viewport frustum.
   */
  public broadcastUpdate(
    updatedAircraft: AircraftTelemetry[],
    removedIds: string[]
  ): void {
    const now = Date.now();
    const effectiveBbox = this.getEffectiveQueryBbox();
    const totalTracked = telemetryStore.getAllAircraft().length;

    for (const session of this.sessions.values()) {
      if (session.socket.readyState !== 1) continue;

      const tuples = this.filterForSessionViewport(updatedAircraft, session);

      this.sendToSession(session, {
        type: 'telemetry_batch',
        timestamp: now,
        source: this.lastUpstreamSource,
        activeBbox: effectiveBbox,
        geohashPrefixes: session.geohashPrefixes,
        tuples,
        removedIds,
        totalGlobalCount: totalTracked,
      });

      if (session.selectedIcao24) {
        const trail = telemetryStore.getTrail(session.selectedIcao24);
        this.sendToSession(session, {
          type: 'aircraft_trail',
          icao24: session.selectedIcao24,
          trail,
        });
      }

      this.sendToSession(session, {
        type: 'system_metrics',
        connectedClients: this.sessions.size,
        totalTrackedAircraft: totalTracked,
        upstreamSource: this.lastUpstreamSource,
        rateLimitRemaining: telemetryStore.getRemainingQuota(),
        redisConnected: telemetryStore.isRedisConnected(),
        pollingIntervalMs: CONFIG.POLLING_INTERVAL_MS,
        activeBbox: effectiveBbox,
      });
    }
  }

  private sendToSession(session: ClientSession, message: ServerWSMessage): void {
    if (session.socket.readyState === 1) {
      session.socket.send(JSON.stringify(message));
    }
  }
}

export const telemetryBroker = new TelemetryWebSocketBroker();
