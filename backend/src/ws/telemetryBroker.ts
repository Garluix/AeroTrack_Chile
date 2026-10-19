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
   * Defaults to Chile's BoundingBox (lamin: -56.5, lomin: -109.5, lamax: -17.5, lomax: -66.0)
   * and expands dynamically if any client pans outside the default domain.
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
   * Sends an immediate spatially-filtered snapshot to a single client session.
   */
  private sendSnapshotToSession(session: ClientSession): void {
    const all = telemetryStore.getAllAircraft();
    const paddedBbox: BoundingBox = {
      lamin: session.bbox.lamin - 3.0,
      lomin: session.bbox.lomin - 3.0,
      lamax: session.bbox.lamax + 3.0,
      lomax: session.bbox.lomax + 3.0,
    };

    const filtered = all.filter(
      (ac) =>
        isPointInBbox(ac.lat, ac.lon, paddedBbox) ||
        ac.icao24 === session.selectedIcao24
    );

    this.sendToSession(session, {
      type: 'telemetry_batch',
      timestamp: Date.now(),
      source: this.lastUpstreamSource,
      activeBbox: this.getEffectiveQueryBbox(),
      geohashPrefixes: session.geohashPrefixes,
      aircraft: filtered,
      removedIds: [],
    });
  }

  /**
   * Broadcasts updated aircraft frames and system metrics to all connected clients,
   * segmented by each client's spatial viewport and geohash cells.
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

      const paddedBbox: BoundingBox = {
        lamin: session.bbox.lamin - 3.0,
        lomin: session.bbox.lomin - 3.0,
        lamax: session.bbox.lamax + 3.0,
        lomax: session.bbox.lomax + 3.0,
      };

      const prefixSet = new Set(session.geohashPrefixes);
      const clientAircraft = updatedAircraft.filter(
        (ac) =>
          prefixSet.has(ac.geohash) ||
          isPointInBbox(ac.lat, ac.lon, paddedBbox) ||
          ac.icao24 === session.selectedIcao24
      );

      this.sendToSession(session, {
        type: 'telemetry_batch',
        timestamp: now,
        source: this.lastUpstreamSource,
        activeBbox: effectiveBbox,
        geohashPrefixes: session.geohashPrefixes,
        aircraft: clientAircraft,
        removedIds,
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
