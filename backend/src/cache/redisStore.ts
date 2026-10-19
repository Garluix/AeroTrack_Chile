import { Redis } from 'ioredis';
import { CONFIG } from '../config/env.js';
import { AircraftTelemetry, TrailBreadcrumb } from '../types/telemetry.js';

export class TelemetryCacheStore {
  private redis: Redis | null = null;
  private redisConnected = false;

  // High-speed in-memory mirror / fallback for sub-millisecond spatial queries
  private memoryStates = new Map<string, AircraftTelemetry>();
  private memorySignatures = new Map<string, string>();
  private memoryTrails = new Map<string, TrailBreadcrumb[]>();
  private rateLimitCooldownUntil = 0;
  private remainingQuota = 400;

  constructor() {
    this.initRedis();
  }

  private initRedis(): void {
    try {
      this.redis = new Redis(CONFIG.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (times: number) => {
          if (times > 3) {
            return null; // Stop noisy retries when running standalone without Redis
          }
          return Math.min(times * 500, 2000);
        },
      });

      this.redis.on('connect', () => {
        this.redisConnected = true;
        console.log('[RedisStore] Connected to Redis volatile cache at', CONFIG.REDIS_URL);
      });

      this.redis.on('error', () => {
        if (this.redisConnected) {
          console.warn('[RedisStore] Redis connection lost, operating on in-memory volatile cache');
        }
        this.redisConnected = false;
      });

      this.redis.connect().catch(() => {
        this.redisConnected = false;
        console.log('[RedisStore] Redis not detected locally; using in-memory volatile store fallback');
      });
    } catch {
      this.redisConnected = false;
    }
  }

  public isRedisConnected(): boolean {
    return this.redisConnected;
  }

  /**
   * Computes a compact state frame signature for deduplication.
   */
  private computeSignature(frame: AircraftTelemetry): string {
    return `${frame.lat.toFixed(5)}:${frame.lon.toFixed(5)}:${Math.round(frame.baro_altitude)}:${Math.round(frame.velocity)}:${Math.round(frame.true_track)}:${frame.squawk ?? 'none'}`;
  }

  /**
   * Upserts a batch of normalized aircraft frames with deduplication and trail persistence.
   * Returns { updated, removedIds }
   */
  public async upsertBatch(frames: AircraftTelemetry[]): Promise<{
    updated: AircraftTelemetry[];
    removedIds: string[];
  }> {
    const nowSec = Math.floor(Date.now() / 1000);
    const updated: AircraftTelemetry[] = [];
    const seenIds = new Set<string>();

    const pipeline = this.redisConnected && this.redis ? this.redis.pipeline() : null;

    for (const frame of frames) {
      seenIds.add(frame.icao24);
      const sig = this.computeSignature(frame);
      const prevSig = this.memorySignatures.get(frame.icao24);

      this.memoryStates.set(frame.icao24, frame);

      // Append breadcrumb to geodesic trail if position moved or trail is empty
      let trail = this.memoryTrails.get(frame.icao24);
      if (!trail) {
        trail = [];
        this.memoryTrails.set(frame.icao24, trail);
      }

      const lastPoint = trail[trail.length - 1];
      const movedEnough =
        !lastPoint ||
        Math.abs(lastPoint.lat - frame.lat) > 0.0004 ||
        Math.abs(lastPoint.lon - frame.lon) > 0.0004;

      if (movedEnough) {
        const breadcrumb: TrailBreadcrumb = {
          lat: frame.lat,
          lon: frame.lon,
          alt: frame.baro_altitude,
          velocity: frame.velocity,
          track: frame.true_track,
          timestamp: frame.server_timestamp,
        };
        trail.push(breadcrumb);
        if (trail.length > CONFIG.TRAIL_MAX_POINTS) {
          trail.shift();
        }
      }

      if (sig !== prevSig) {
        this.memorySignatures.set(frame.icao24, sig);
        updated.push(frame);

        if (pipeline) {
          const stateKey = `${CONFIG.REDIS_KEY_PREFIX}state:${frame.icao24}`;
          const trailKey = `${CONFIG.REDIS_KEY_PREFIX}trail:${frame.icao24}`;
          pipeline.set(stateKey, JSON.stringify(frame), 'EX', CONFIG.STATE_TTL_SECONDS);
          pipeline.set(trailKey, JSON.stringify(trail), 'EX', CONFIG.STATE_TTL_SECONDS * 3);
        }
      } else {
        // Still include active aircraft in periodic broadcast so new/existing clients have synchronized timestamps
        updated.push(frame);
      }
    }

    // Evict stale aircraft exceeding STATE_TTL_SECONDS
    const removedIds: string[] = [];
    for (const [icao24, state] of this.memoryStates.entries()) {
      const ageSec = nowSec - state.last_contact;
      if (!seenIds.has(icao24) && ageSec > CONFIG.STATE_TTL_SECONDS) {
        this.memoryStates.delete(icao24);
        this.memorySignatures.delete(icao24);
        this.memoryTrails.delete(icao24);
        removedIds.push(icao24);
        if (pipeline) {
          pipeline.del(`${CONFIG.REDIS_KEY_PREFIX}state:${icao24}`);
        }
      }
    }

    if (pipeline) {
      try {
        await pipeline.exec();
      } catch {
        // Non-fatal pipeline error; memory store remains authoritative
      }
    }

    return { updated, removedIds };
  }

  public getAllAircraft(): AircraftTelemetry[] {
    return Array.from(this.memoryStates.values());
  }

  public getAircraft(icao24: string): AircraftTelemetry | undefined {
    return this.memoryStates.get(icao24.toLowerCase());
  }

  public getTrail(icao24: string): TrailBreadcrumb[] {
    return this.memoryTrails.get(icao24.toLowerCase()) || [];
  }

  /**
   * Rate-limit & quota management for external ADS-B APIs
   */
  public async canConsumeUpstreamQuota(): Promise<boolean> {
    if (Date.now() < this.rateLimitCooldownUntil) {
      return false;
    }

    if (this.redisConnected && this.redis) {
      try {
        const key = `${CONFIG.REDIS_KEY_PREFIX}ratelimit:window`;
        const current = await this.redis.incr(key);
        if (current === 1) {
          await this.redis.expire(key, 60);
        }
        // Max 15 upstream calls per minute
        if (current > 15) {
          return false;
        }
      } catch {
        // Ignore Redis error
      }
    }

    return true;
  }

  public registerUpstreamRateLimit(retryAfterSeconds = 30): void {
    this.rateLimitCooldownUntil = Date.now() + retryAfterSeconds * 1000;
    this.remainingQuota = Math.max(0, this.remainingQuota - 10);
  }

  public updateRemainingQuota(quota: number): void {
    this.remainingQuota = quota;
  }

  public getRemainingQuota(): number {
    return this.remainingQuota;
  }
}

export const telemetryStore = new TelemetryCacheStore();
