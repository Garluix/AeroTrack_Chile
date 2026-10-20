import { useEffect, useRef } from 'react';
import { useFlightStore } from '../store/useFlightStore';
import { BoundingBox, KinematicAircraft } from '../types/telemetry';
import {
  isEmergencySquawk,
  stepAircraftKinematics,
  writeAltitudeColorRGBA,
} from '../utils/kinematics';

export interface KinematicTypedBuffers {
  positions: Float32Array;
  angles: Float32Array;
  sizes: Float32Array;
  colors: Uint8Array;
  count: number;
}

export interface ViewportCullState {
  frustum: BoundingBox | null;
  zoom: number;
}

const MAX_GPU_ENTITIES = 25000;

/**
 * 60/120 FPS requestAnimationFrame Dead Reckoning & Spherical Great Circle interpolation loop:
 *   P(t) = P_anterior + (P_objetivo(t) - P_anterior) * alpha
 * - Decouples network WebSocket arrival from WebGL rendering.
 * - Maintains pre-allocated typed binary buffers (Float32Array / Uint8Array) for >20,000 instances.
 * - Dynamic Viewport Culling:
 *   * High zoom (regional/city): prioritizes entities inside the camera frustum with full 3D Great Circle Slerp,
 *     omitting off-screen entities from GPU upload.
 *   * Low/continental zoom (e.g. United States or Global view): renders 100% of markers in view without artificial limits.
 */
export function useDeadReckoning(
  onFrame: (
    aircraftList: KinematicAircraft[],
    pulsePhase: number,
    frameTimeMs: number,
    frameDtSec: number,
    buffers: KinematicTypedBuffers
  ) => void,
  getViewportState?: () => ViewportCullState
): void {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const getViewportStateRef = useRef(getViewportState);
  getViewportStateRef.current = getViewportState;

  // Pre-allocated binary typed buffers outside React reconciliation (Zero GC allocations at 60 FPS)
  const positionsBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES * 3));
  const anglesBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES));
  const sizesBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES));
  const colorsBufferRef = useRef<Uint8Array>(new Uint8Array(MAX_GPU_ENTITIES * 4));
  const visibleListRef = useRef<KinematicAircraft[]>([]);

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
      const selectedId = state.selectedIcao24;

      const vpState = getViewportStateRef.current
        ? getViewportStateRef.current()
        : { frustum: null, zoom: 6.0 };
      const frustum = vpState.frustum;
      const zoom = vpState.zoom;

      // High-zoom regional view vs country/continental/world view
      const isHighZoomRegional = zoom >= 5.5;
      const isGlobalView = zoom <= 2.8;
      const baseIconSize = zoom < 3.5 ? 16 : zoom < 5.2 ? 20 : 24;

      // Compute smooth sinusoidal pulse [0, 1] for emergency squawks (7500, 7600, 7700)
      const pulsePhase = 0.5 + 0.5 * Math.sin(nowMs * 0.009);

      const renderedList = visibleListRef.current;
      renderedList.length = 0;

      const positions = positionsBufferRef.current;
      const angles = anglesBufferRef.current;
      const sizes = sizesBufferRef.current;
      const colors = colorsBufferRef.current;
      let gpuIdx = 0;

      for (const ac of map.values()) {
        const isSelected = ac.icao24 === selectedId;
        const isEmergency = isEmergencySquawk(ac.squawk);

        // Dynamic Viewport Frustum Culling:
        // When zoomed into a specific region (or continent), omit entities outside the visible camera frustum
        // BEFORE running heavy per-frame trigonometry or uploading to the GPU.
        // In full world view (isGlobalView), render all global markers without clipping.
        if (
          frustum &&
          !isGlobalView &&
          !isSelected &&
          !isEmergency &&
          (ac.renderLat < frustum.lamin ||
            ac.renderLat > frustum.lamax ||
            ac.renderLon < frustum.lomin ||
            ac.renderLon > frustum.lomax)
        ) {
          continue;
        }

        if (activeFilter !== 'ALL' && ac.fir !== activeFilter && !isSelected) {
          continue;
        }

        if (
          searchQuery &&
          !isSelected &&
          !ac.callsign.toLowerCase().includes(searchQuery) &&
          !ac.icao24.toLowerCase().includes(searchQuery) &&
          !(ac.squawk && ac.squawk.includes(searchQuery)) &&
          !ac.origin_country.toLowerCase().includes(searchQuery)
        ) {
          continue;
        }

        // Advance kinematics with high-detail 3D Great Circle Slerp at regional zoom (or for selected aircraft)
        // and fast cosine-geodesic Dead Reckoning at continental/world zoom (10,000+ simultaneous icons)
        stepAircraftKinematics(ac, nowMs, frameDtSec, isHighZoomRegional || isSelected);

        renderedList.push(ac);

        if (gpuIdx < MAX_GPU_ENTITIES) {
          const posOffset = gpuIdx * 3;
          positions[posOffset] = ac.renderLon;
          positions[posOffset + 1] = ac.renderLat;
          positions[posOffset + 2] = 0;

          angles[gpuIdx] = (360 - ac.renderTrack) % 360;
          sizes[gpuIdx] = isSelected ? 32 : isEmergency ? 30 : baseIconSize;

          writeAltitudeColorRGBA(
            colors,
            gpuIdx * 4,
            ac.renderAlt,
            ac.squawk,
            isSelected,
            pulsePhase
          );

          gpuIdx++;
        }
      }

      onFrameRef.current(renderedList, pulsePhase, nowMs, frameDtSec, {
        positions,
        angles,
        sizes,
        colors,
        count: gpuIdx,
      });

      // Periodically sync HUD telemetry readout (~4Hz) and FPS counter (~1Hz)
      if (nowMs - lastSelectedSyncTime > 250) {
        lastSelectedSyncTime = nowMs;
        if (state.selectedIcao24) {
          state.syncSelectedSnapshot();
        }
      }

      if (nowMs - lastFpsSampleTime >= 1000) {
        const currentFps = Math.min(
          120,
          Math.round((fpsCounter * 1000) / (nowMs - lastFpsSampleTime))
        );
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
