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
  iconDefs: Float32Array;
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
 * - Applies the 3-category tactical filter ('all' | 'planes' | 'helicopters') in-memory before GPU buffer injection.
 * - Maintains pre-allocated typed binary buffers (Float32Array / Uint8Array) for >20,000 instances.
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

  // Pre-allocated binary typed buffers outside React reconciliation (Zero GC allocations at 60/120 FPS)
  const positionsBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES * 3));
  const anglesBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES));
  const sizesBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES));
  const colorsBufferRef = useRef<Uint8Array>(new Uint8Array(MAX_GPU_ENTITIES * 4));
  const iconDefsBufferRef = useRef<Float32Array>(new Float32Array(MAX_GPU_ENTITIES * 7));
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
      const activeFilter = state.activeFIRFilter || 'ALL';
      const filterType = state.filterType || 'all';
      const searchQuery = (state.searchQuery || '').trim().toLowerCase();
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
      const iconDefs = iconDefsBufferRef.current;
      let gpuIdx = 0;

      for (const ac of map.values()) {
        const isHeli = Boolean(ac.isHelicopter);
        // 1. In-memory category filtering BEFORE GPU buffer injection (zero React re-renders)
        // Safe fallback: when filterType === 'all' or undefined, render the entire aircraft catalog
        if (filterType === 'planes' && isHeli) {
          continue;
        }
        if (filterType === 'helicopters' && !isHeli) {
          continue;
        }

        const isSelected = ac.icao24 === selectedId;
        const isEmergency = isEmergencySquawk(ac.squawk);

        // 2. Dynamic Viewport Frustum Culling:
        // When zoomed into a specific region (or continent), omit entities outside the visible camera frustum
        // BEFORE running heavy per-frame trigonometry or uploading to the GPU.
        // We bypass frustum culling when the user specifically selects helicopters or global view,
        // so the rotorcraft swarm (~400 entities globally) is always visible and actionable.
        const bypassFrustum = isGlobalView || isSelected || isEmergency || filterType === 'helicopters';
        if (
          frustum &&
          !bypassFrustum &&
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
          sizes[gpuIdx] = isSelected
            ? 32
            : isEmergency
            ? 30
            : ac.isHelicopter
            ? baseIconSize + 2
            : baseIconSize;

          // Deck.gl IconLayer instanceIconDefs binary layout (7 floats):
          // [width/2 - anchorX, height/2 - anchorY, x, y, width, height, mask ? 1 : 0]
          // Slot 0 ('aircraft'): x = 0, y = 0, w = 128, h = 128, anchor = (64,64), mask = 1
          // Slot 1 ('helicopter'): x = 128, y = 0, w = 128, h = 128, anchor = (64,64), mask = 1
          const iconOffset = gpuIdx * 7;
          iconDefs[iconOffset] = 0;
          iconDefs[iconOffset + 1] = 0;
          iconDefs[iconOffset + 2] = ac.isHelicopter ? 128 : 0;
          iconDefs[iconOffset + 3] = 0;
          iconDefs[iconOffset + 4] = 128;
          iconDefs[iconOffset + 5] = 128;
          iconDefs[iconOffset + 6] = 1;

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

      try {
        onFrameRef.current(renderedList, pulsePhase, nowMs, frameDtSec, {
          positions,
          angles,
          sizes,
          colors,
          iconDefs,
          count: gpuIdx,
        });
      } catch (err) {
        console.error('[useDeadReckoning] Frame render error:', err);
      }

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
