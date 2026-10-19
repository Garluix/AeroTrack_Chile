import { CONFIG } from '../config/env.js';
import { adsbClient } from '../services/adsbClient.js';
import { telemetryStore } from '../cache/redisStore.js';
import { telemetryBroker } from '../ws/telemetryBroker.js';

export class TelemetryPollingWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastPollTimeMs = 0;

  public async start(): Promise<void> {
    if (this.timer) return;
    console.log(
      `[TelemetryPoller] Starting LIVE ADS-B ingestion worker (interval: ${CONFIG.POLLING_INTERVAL_MS}ms, default bbox: [${CONFIG.CHILE_DEFAULT_BBOX.lamin}, ${CONFIG.CHILE_DEFAULT_BBOX.lomin}] -> [${CONFIG.CHILE_DEFAULT_BBOX.lamax}, ${CONFIG.CHILE_DEFAULT_BBOX.lomax}])`
    );

    // Execute initial live ADS-B poll
    await this.pollCycle();

    this.timer = setInterval(() => {
      void this.pollCycle();
    }, CONFIG.POLLING_INTERVAL_MS);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Triggers an on-demand poll when a client pans to a new region of the globe,
   * throttled to a minimum 2.5s interval to respect upstream community API quotas.
   */
  public triggerOnDemandPoll(): void {
    if (this.isRunning) return;
    if (Date.now() - this.lastPollTimeMs < 2500) return;
    void this.pollCycle();
  }

  private async pollCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastPollTimeMs = Date.now();

    try {
      const effectiveBbox = telemetryBroker.getEffectiveQueryBbox();
      const { aircraft, source } = await adsbClient.ingestTelemetry(effectiveBbox);

      telemetryBroker.setLastUpstreamSource(source);
      const { updated, removedIds } = await telemetryStore.upsertBatch(aircraft);

      telemetryBroker.broadcastUpdate(updated, removedIds);
    } catch (err) {
      console.error('[TelemetryPoller] Cycle error:', err);
    } finally {
      this.isRunning = false;
    }
  }
}

export const telemetryPoller = new TelemetryPollingWorker();
