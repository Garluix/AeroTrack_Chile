import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { CONFIG, CHILE_FIRS } from './config/env.js';
import { telemetryStore } from './cache/redisStore.js';
import { telemetryBroker } from './ws/telemetryBroker.js';
import { telemetryPoller } from './workers/telemetryPoller.js';
import { adsbClient } from './services/adsbClient.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

async function bootstrap(): Promise<void> {
  await app.register(cors, {
    origin: CONFIG.CORS_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024 * 1024,
      perMessageDeflate: true,
    },
  });

  // Health & Readiness probe
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'aerotrack-chile-telemetry-gateway',
    timestamp: new Date().toISOString(),
    redisConnected: telemetryStore.isRedisConnected(),
    trackedAircraft: telemetryStore.getAllAircraft().length,
    connectedClients: telemetryBroker.getConnectedClientCount(),
    upstreamSource: telemetryBroker.getLastUpstreamSource(),
    defaultBbox: CONFIG.CHILE_DEFAULT_BBOX,
    activeBbox: telemetryBroker.getEffectiveQueryBbox(),
  }));

  // Chilean FIR polygon & boundary definitions (SCEZ, SCFA, SCTE, SCCF, SCIP)
  app.get('/api/firs', async () => ({
    firs: CHILE_FIRS,
    defaultBbox: CONFIG.CHILE_DEFAULT_BBOX,
  }));

  // Snapshot of currently tracked aircraft
  app.get('/api/flights', async () => ({
    timestamp: Date.now(),
    source: telemetryBroker.getLastUpstreamSource(),
    aircraft: telemetryStore.getAllAircraft(),
  }));

  // Historical geodesic breadcrumb trail for a specific aircraft
  app.get<{ Params: { icao24: string } }>('/api/flights/:icao24/trail', async (req) => {
    const { icao24 } = req.params;
    return {
      icao24: icao24.toLowerCase(),
      aircraft: telemetryStore.getAircraft(icao24) ?? null,
      trail: telemetryStore.getTrail(icao24),
    };
  });

  // Aircraft photograph (Planespotters.net) & exact airframe model metadata (HexDB + ICAO type)
  app.get<{ Params: { icao24: string } }>('/api/flights/:icao24/photo', async (req) => {
    const { icao24 } = req.params;
    return adsbClient.fetchAircraftPhotoAndMetadata(icao24);
  });

  // Tactical emergency squawk simulator endpoint (7500 / 7600 / 7700 / 1200)
  app.post<{ Body: { icao24?: string; squawk: '7500' | '7600' | '7700' | '1200' } }>(
    '/api/simulate/squawk',
    async (req) => {
      const { icao24, squawk } = req.body;
      const updatedIcao = adsbClient.setAircraftSquawk(icao24, squawk);
      if (updatedIcao) {
        const current = telemetryStore.getAircraft(updatedIcao);
        if (current) {
          current.squawk = squawk;
        }
      }
      return { ok: true, icao24: updatedIcao, squawk };
    }
  );

  // Native WebSocket endpoint with Spatial Geohash segmentation
  app.get('/ws', { websocket: true }, (socket) => {
    const sessionId = randomUUID();
    telemetryBroker.registerClient(sessionId, socket);
  });

  await telemetryPoller.start();

  await app.listen({
    port: CONFIG.PORT,
    host: CONFIG.HOST,
  });

  console.log(
    `[AeroTrack Gateway] Listening on http://${CONFIG.HOST}:${CONFIG.PORT} (WS: ws://${CONFIG.HOST}:${CONFIG.PORT}/ws)`
  );
}

const shutdown = async () => {
  telemetryPoller.stop();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap().catch((err) => {
  console.error('[AeroTrack Gateway] Fatal startup error:', err);
  process.exit(1);
});
