import { useEffect, useRef } from 'react';
import { useFlightStore } from '../store/useFlightStore';
import { KinematicAircraft } from '../types/telemetry';
import { stepAircraftKinematics } from '../utils/kinematics';

/**
 * 60 FPS requestAnimationFrame Dead Reckoning & Spherical Great Circle interpolation loop.
 * - Continuously advances every aircraft's (renderLat, renderLon, renderAlt, renderTrack)
 *   from its last authoritative coordinate P_0 using ground speed, true_track, and elapsed time dt.
 * - Smooths convergence toward new WebSocket coordinates via exponential error decay.
 * - Invokes `onFrame` with the live kinematic array and a pulsing phase [0..1] for emergency squawks
 *   without causing React component tree re-renders on every frame.
 */
export function useDeadReckoning(
  onFrame: (aircraftList: KinematicAircraft[], pulsePhase: number, frameTimeMs: number) => void
): void {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let rafId = 0;
    let lastFrameTime = performance.now();
    let fpsCounter = 0;
    let lastFpsSampleTime = performance.now();
    let lastSelectedSyncTime = performance.now();

    const animate = (nowMs: number) => {
      const frameDtSec = Math.min(0.1, Math.max(0.001, (nowMs - lastFrameTime) / 1000.0));
      lastFrameTime = nowMs;
      fpsCounter++;

      const state = useFlightStore.getState();
      const map = state.kinematicMap;
      const activeFilter = state.activeFIRFilter;
      const searchQuery = state.searchQuery.trim().toLowerCase();

      const renderedList: KinematicAircraft[] = [];

      for (const ac of map.values()) {
        stepAircraftKinematics(ac, nowMs, frameDtSec);

        if (activeFilter !== 'ALL' && ac.fir !== activeFilter) {
          continue;
        }

        if (
          searchQuery &&
          !ac.callsign.toLowerCase().includes(searchQuery) &&
          !ac.icao24.toLowerCase().includes(searchQuery) &&
          !(ac.squawk && ac.squawk.includes(searchQuery)) &&
          !ac.origin_country.toLowerCase().includes(searchQuery)
        ) {
          continue;
        }

        renderedList.push(ac);
      }

      // Compute smooth sinusoidal pulse [0, 1] for emergency squawks (7500, 7600, 7700)
      const pulsePhase = 0.5 + 0.5 * Math.sin(nowMs * 0.009);

      onFrameRef.current(renderedList, pulsePhase, nowMs);

      // Periodically sync HUD telemetry readout (~4Hz) and FPS counter (~1Hz)
      if (nowMs - lastSelectedSyncTime > 250) {
        lastSelectedSyncTime = nowMs;
        if (state.selectedIcao24) {
          state.syncSelectedSnapshot();
        }
      }

      if (nowMs - lastFpsSampleTime >= 1000) {
        const currentFps = Math.min(60, Math.round((fpsCounter * 1000) / (nowMs - lastFpsSampleTime)));
        fpsCounter = 0;
        lastFpsSampleTime = nowMs;
        state.updateSystemMetrics({ fps: currentFps });
      }

      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);
}
