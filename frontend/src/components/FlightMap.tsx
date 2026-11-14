import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { IconLayer, PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { PickingInfo } from '@deck.gl/core';
import { useFlightStore } from '../store/useFlightStore';
import { useDeadReckoning } from '../hooks/useDeadReckoning';
import { BoundingBox, FIRDefinition, KinematicAircraft } from '../types/telemetry';
import {
  createAircraftIconAtlasDataUrl,
  getAltitudeColorRGBA,
  isEmergencySquawk,
  metersToFeet,
  msToKnots,
} from '../utils/kinematics';

interface FlightMapProps {
  onViewportChanged: (bbox: BoundingBox, zoom: number) => void;
}

interface BreadcrumbSegment {
  path: [number, number][];
  color: [number, number, number, number];
}

const INITIAL_LAT = Number(import.meta.env.VITE_INITIAL_LAT ?? -33.4489);
const INITIAL_LON = Number(import.meta.env.VITE_INITIAL_LON ?? -70.6693);
const INITIAL_ZOOM = Number(import.meta.env.VITE_INITIAL_ZOOM ?? 6.0);

const AIRCRAFT_ICON_ATLAS = createAircraftIconAtlasDataUrl();
const AIRCRAFT_ICON_MAPPING = {
  aircraft: {
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    anchorX: 64, // Exact center pivot X
    anchorY: 64, // Exact center pivot Y
    mask: true,
  },
  helicopter: {
    x: 128,
    y: 0,
    width: 128,
    height: 128,
    anchorX: 64, // Exact center pivot X
    anchorY: 64, // Exact center pivot Y
    mask: true,
  },
};

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 56;
  const g = parseInt(clean.substring(2, 4), 16) || 189;
  const b = parseInt(clean.substring(4, 6), 16) || 248;
  return [r, g, b, alpha];
}

function buildOpenStreetMapStyle(darkRadar: boolean): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: darkRadar ? 'OpenStreetMap Tactical Radar' : 'OpenStreetMap Standard',
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      {
        id: 'osm-raster-layer',
        type: 'raster',
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 19,
        paint: darkRadar
          ? {
              'raster-brightness-max': 0.52,
              'raster-brightness-min': 0.04,
              'raster-contrast': 0.28,
              'raster-saturation': -0.65,
            }
          : {
              'raster-brightness-max': 1.0,
              'raster-contrast': 0.05,
              'raster-saturation': 0.0,
            },
      },
    ],
  };
}

export const FlightMap: React.FC<FlightMapProps> = ({ onViewportChanged }) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const viewportDebounceRef = useRef<number | null>(null);

  // Mutable geospatial frustum bounds & zoom for GPU Frustum Culling (updated without React re-renders)
  const frustumBoundsRef = useRef<BoundingBox | null>(null);
  const currentZoomRef = useRef<number>(INITIAL_ZOOM);

  // Track last emitted viewport to avoid spamming WS viewport_changed during 60 FPS Camera Lock
  const lastEmittedViewportRef = useRef<{
    lat: number;
    lon: number;
    zoom: number;
    timeMs: number;
  }>({
    lat: INITIAL_LAT,
    lon: INITIAL_LON,
    zoom: INITIAL_ZOOM,
    timeMs: 0,
  });

  // Smoothly dampened camera coordinates for Camera Lock ("Modo Seguimiento")
  const dampedCameraRef = useRef<{
    lon: number;
    lat: number;
    lockedId: string | null;
  }>({
    lon: INITIAL_LON,
    lat: INITIAL_LAT,
    lockedId: null,
  });

  const [hoveredAircraft, setHoveredAircraft] = useState<{
    x: number;
    y: number;
    aircraft: KinematicAircraft;
  } | null>(null);

  const setSelectedIcao24 = useFlightStore((s) => s.setSelectedIcao24);
  const cameraTarget = useFlightStore((s) => s.cameraTarget);

  // Initialize MapLibre GL JS with 100% open, watermark-free OpenStreetMap / MapLibre Demo tiles
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: buildOpenStreetMapStyle(true),
      center: [INITIAL_LON, INITIAL_LAT],
      zoom: INITIAL_ZOOM,
      pitch: 18,
      bearing: 0,
      maxPitch: 65,
      attributionControl: { compact: true },
    });

    const deckOverlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });

    map.addControl(deckOverlay as unknown as maplibregl.IControl);
    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
      'bottom-right'
    );

    const syncFrustumBounds = () => {
      const b = map.getBounds();
      currentZoomRef.current = map.getZoom();
      const latSpan = Math.max(1.0, b.getNorth() - b.getSouth());
      const lonSpan = Math.max(1.0, b.getEast() - b.getWest());
      const latPad = latSpan * 0.12;
      const lonPad = lonSpan * 0.12;
      frustumBoundsRef.current = {
        lamin: Math.max(-85, b.getSouth() - latPad),
        lomin: Math.max(-180, b.getWest() - lonPad),
        lamax: Math.min(85, b.getNorth() + latPad),
        lomax: Math.min(180, b.getEast() + lonPad),
      };
    };

    const emitBounds = () => {
      syncFrustumBounds();

      const isFollowing = useFlightStore.getState().followSelectedAircraft;
      const now = performance.now();
      const center = map.getCenter();
      const zoom = map.getZoom();
      const last = lastEmittedViewportRef.current;

      const distMovedDeg = Math.hypot(center.lat - last.lat, center.lng - last.lon);
      const zoomDiff = Math.abs(zoom - last.zoom);

      // During 60/120 FPS Camera Lock, do NOT spam WS viewport_changed on every frame
      if (isFollowing) {
        if (now - last.timeMs < 5000 && distMovedDeg < 1.5 && zoomDiff < 0.6) {
          return;
        }
        lastEmittedViewportRef.current = {
          lat: center.lat,
          lon: center.lng,
          zoom,
          timeMs: now,
        };
        const bounds = map.getBounds();
        onViewportChanged(
          {
            lamin: Number(bounds.getSouth().toFixed(3)),
            lomin: Number(bounds.getWest().toFixed(3)),
            lamax: Number(bounds.getNorth().toFixed(3)),
            lomax: Number(bounds.getEast().toFixed(3)),
          },
          Number(zoom.toFixed(2))
        );
        return;
      }

      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current);
      }
      viewportDebounceRef.current = window.setTimeout(() => {
        const bounds = map.getBounds();
        const c = map.getCenter();
        const z = map.getZoom();
        lastEmittedViewportRef.current = {
          lat: c.lat,
          lon: c.lng,
          zoom: z,
          timeMs: performance.now(),
        };
        onViewportChanged(
          {
            lamin: Number(bounds.getSouth().toFixed(3)),
            lomin: Number(bounds.getWest().toFixed(3)),
            lamax: Number(bounds.getNorth().toFixed(3)),
            lomax: Number(bounds.getEast().toFixed(3)),
          },
          Number(z.toFixed(2))
        );
      }, 280);
    };

    // Disengage Camera Lock if the user manually drags the map canvas
    const handleDragStart = () => {
      if (useFlightStore.getState().followSelectedAircraft) {
        useFlightStore.getState().setFollowSelectedAircraft(false);
      }
    };

    map.on('load', emitBounds);
    map.on('move', syncFrustumBounds);
    map.on('moveend', emitBounds);
    map.on('dragstart', handleDragStart);

    mapRef.current = map;
    deckOverlayRef.current = deckOverlay;

    return () => {
      if (viewportDebounceRef.current) window.clearTimeout(viewportDebounceRef.current);
      map.off('dragstart', handleDragStart);
      map.off('move', syncFrustumBounds);
      map.remove();
      mapRef.current = null;
      deckOverlayRef.current = null;
    };
  }, [onViewportChanged]);

  // Smooth camera transitions when user selects a FIR sector, Global preset, or "Centrar en Traza"
  useEffect(() => {
    if (!cameraTarget || !mapRef.current) return;
    const state = useFlightStore.getState();

    // If Camera Lock is active on the selected aircraft, update zoom/pitch without starting a competing flyTo timer
    if (state.followSelectedAircraft && state.selectedIcao24) {
      const tracked = state.kinematicMap.get(state.selectedIcao24);
      if (tracked) {
        dampedCameraRef.current = {
          lon: tracked.renderLon,
          lat: tracked.renderLat,
          lockedId: state.selectedIcao24,
        };
        mapRef.current.jumpTo({
          center: [tracked.renderLon, tracked.renderLat],
          zoom: cameraTarget.zoom,
          pitch: cameraTarget.pitch ?? 35,
          bearing: cameraTarget.bearing ?? 0,
        });
        return;
      }
    }

    mapRef.current.flyTo({
      center: [cameraTarget.lon, cameraTarget.lat],
      zoom: cameraTarget.zoom,
      pitch: cameraTarget.pitch ?? 18,
      bearing: cameraTarget.bearing ?? 0,
      duration: 1400,
      essential: true,
    });
  }, [cameraTarget]);

  // 60/120 FPS Kinematic Dead Reckoning loop updating Deck.gl WebGL layers & dampened Camera Lock directly
  useDeadReckoning(
    (aircraftList, pulsePhase, frameTimeMs, frameDtSec, buffers) => {
      const overlay = deckOverlayRef.current;
      if (!overlay) return;

      const state = useFlightStore.getState();
      const selectedId = state.selectedIcao24;
      const firs = state.firs;
      const showFIRs = state.showFIRBoundaries;
      const trail = state.selectedTrail;

      // Smooth Camera Lock ("Modo Seguimiento"): synchronize camera per-frame with exponential dampening
      if (state.followSelectedAircraft && selectedId && mapRef.current) {
        const tracked = state.kinematicMap.get(selectedId);
        if (tracked) {
          const cam = dampedCameraRef.current;
          if (cam.lockedId !== selectedId) {
            const currentCenter = mapRef.current.getCenter();
            const distDeg = Math.hypot(
              tracked.renderLon - currentCenter.lng,
              tracked.renderLat - currentCenter.lat
            );
            // If locking onto a distant aircraft (> 1.2 deg away), snap once to its render position, then dampen smoothly
            cam.lon = distDeg > 1.2 ? tracked.renderLon : currentCenter.lng;
            cam.lat = distDeg > 1.2 ? tracked.renderLat : currentCenter.lat;
            cam.lockedId = selectedId;
          }

          // Camera dampening factor alpha_cam = 1 - exp(-10 * dt) for silky zero-jitter tracking
          const camAlpha = Math.min(1.0, 1.0 - Math.exp(-10.0 * frameDtSec));
          cam.lon = cam.lon + (tracked.renderLon - cam.lon) * camAlpha;
          cam.lat = cam.lat + (tracked.renderLat - cam.lat) * camAlpha;

          mapRef.current.jumpTo({
            center: [cam.lon, cam.lat],
          });
        }
      } else {
        dampedCameraRef.current.lockedId = null;
      }

      const frustum = frustumBoundsRef.current;

      // Build altitude-graded geodesic trail segments for the selected aircraft (with frustum culling)
      const breadcrumbSegments: BreadcrumbSegment[] = [];
      if (selectedId && trail.length > 0) {
        const selectedAc = state.kinematicMap.get(selectedId);
        const fullPoints = [
          ...trail.map((pt) => ({ lon: pt.lon, lat: pt.lat, alt: pt.alt })),
          ...(selectedAc
            ? [{ lon: selectedAc.renderLon, lat: selectedAc.renderLat, alt: selectedAc.renderAlt }]
            : []),
        ];

        for (let i = 0; i < fullPoints.length - 1; i++) {
          const p1 = fullPoints[i];
          const p2 = fullPoints[i + 1];

          // Frustum Culling for trail segments
          if (
            frustum &&
            (p1.lat < frustum.lamin ||
              p1.lat > frustum.lamax ||
              p1.lon < frustum.lomin ||
              p1.lon > frustum.lomax) &&
            (p2.lat < frustum.lamin ||
              p2.lat > frustum.lamax ||
              p2.lon < frustum.lomin ||
              p2.lon > frustum.lomax)
          ) {
            continue;
          }

          breadcrumbSegments.push({
            path: [
              [p1.lon, p1.lat],
              [p2.lon, p2.lat],
            ],
            color: getAltitudeColorRGBA((p1.alt + p2.alt) / 2, null, false),
          });
        }
      }

      // Filter emergency or selected aircraft for tactical radar ring highlights
      const highlightedAircraft = aircraftList.filter(
        (ac) => ac.icao24 === selectedId || isEmergencySquawk(ac.squawk)
      );

      const layers = [
        // 1. Chilean FIR Boundaries Layer (SCEZ, SCFA, SCTE, SCCF, SCIP)
        new PolygonLayer<FIRDefinition>({
          id: 'chile-firs-layer',
          data: showFIRs ? firs : [],
          pickable: false,
          stroked: true,
          filled: true,
          wireframe: false,
          lineWidthMinPixels: 1.4,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => hexToRgba(d.color, 18),
          getLineColor: (d) => hexToRgba(d.color, 130),
        }),

        // 2. Historical Geodesic Flight Breadcrumbs with Altitude Profile Gradient
        new PathLayer<BreadcrumbSegment>({
          id: 'flight-breadcrumbs-layer',
          data: breadcrumbSegments,
          pickable: false,
          widthScale: 1,
          widthMinPixels: 3.5,
          widthMaxPixels: 6,
          capRounded: true,
          jointRounded: true,
          getPath: (d) => d.path,
          getColor: (d) => d.color,
          getWidth: 4,
        }),

        // 3. Pulsing Tactical Rings for Selected Aircraft & Emergency Squawks (7500/7600/7700)
        new ScatterplotLayer<KinematicAircraft>({
          id: 'tactical-halo-layer',
          data: highlightedAircraft,
          pickable: false,
          stroked: true,
          filled: true,
          radiusUnits: 'pixels',
          lineWidthMinPixels: 2,
          getPosition: (d) => [d.renderLon, d.renderLat],
          getRadius: (d) =>
            isEmergencySquawk(d.squawk) ? 14 + pulsePhase * 12 : 16,
          getFillColor: (d) =>
            isEmergencySquawk(d.squawk)
              ? [239, 68, 68, Math.round(45 + pulsePhase * 65)]
              : [250, 204, 21, 45],
          getLineColor: (d) =>
            isEmergencySquawk(d.squawk)
              ? [255, 50, 50, Math.round(180 + pulsePhase * 75)]
              : [250, 204, 21, 235],
          updateTriggers: {
            getPosition: frameTimeMs,
            getRadius: frameTimeMs,
            getFillColor: frameTimeMs,
            getLineColor: frameTimeMs,
          },
        }),

        // 4. High-Volume WebGL Instanced Aircraft & Helicopter IconLayer driven directly by Float32Array & Uint8Array buffers
        new IconLayer({
          id: 'aircraft-kinematic-icon-layer',
          data: {
            length: buffers.count,
            attributes: {
              getPosition: {
                value: buffers.positions.subarray(0, buffers.count * 3),
                size: 3,
              },
              getAngle: {
                value: buffers.angles.subarray(0, buffers.count),
                size: 1,
              },
              getSize: {
                value: buffers.sizes.subarray(0, buffers.count),
                size: 1,
              },
              getColor: {
                value: buffers.colors.subarray(0, buffers.count * 4),
                size: 4,
              },
              instanceIconDefs: {
                value: buffers.iconDefs.subarray(0, buffers.count * 7),
                size: 7,
              },
            },
          },
          pickable: true,
          iconAtlas: AIRCRAFT_ICON_ATLAS,
          iconMapping: AIRCRAFT_ICON_MAPPING,
          getIcon: ((d: KinematicAircraft | undefined, { index }: { index: number }) =>
            (d?.isHelicopter ?? aircraftList[index]?.isHelicopter) ? 'helicopter' : 'aircraft') as unknown as () => string,
          updateTriggers: {
            getIcon: [frameTimeMs, buffers.count, state.filterType],
          },
          sizeScale: 1,
          sizeUnits: 'pixels',
          sizeMinPixels: currentZoomRef.current < 4.0 ? 12 : 18,
          sizeMaxPixels: 38,
          billboard: false,
          onHover: (info: PickingInfo) => {
            const picked =
              typeof info.index === 'number' && info.index >= 0
                ? aircraftList[info.index]
                : undefined;
            if (picked) {
              setHoveredAircraft({
                x: info.x,
                y: info.y,
                aircraft: picked,
              });
            } else {
              setHoveredAircraft(null);
            }
          },
          onClick: (info: PickingInfo) => {
            const picked =
              typeof info.index === 'number' && info.index >= 0
                ? aircraftList[info.index]
                : undefined;
            if (picked) {
              setSelectedIcao24(picked.icao24);
            }
          },
        }),
      ];

      overlay.setProps({ layers });
    },
    () => ({
      frustum: frustumBoundsRef.current,
      zoom: currentZoomRef.current,
    })
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      <div
        ref={mapContainerRef}
        className="w-full h-full cursor-crosshair"
      />

      {/* Instant hover tactical micro-tag */}
      {hoveredAircraft && (
        <div
          className="pointer-events-none fixed z-30 px-3 py-2 rounded-lg bg-slate-950/90 backdrop-blur-md border border-cyan-500/40 shadow-xl text-xs font-mono"
          style={{
            left: hoveredAircraft.x + 14,
            top: hoveredAircraft.y - 14,
          }}
        >
          <div className="flex items-center gap-2 font-bold text-cyan-300">
            <span>{hoveredAircraft.aircraft.callsign}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {hoveredAircraft.aircraft.fir}
            </span>
            {hoveredAircraft.aircraft.isHelicopter && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                HELI
              </span>
            )}
            {hoveredAircraft.aircraft.aircraft_code && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-amber-300 border border-amber-500/30">
                {hoveredAircraft.aircraft.aircraft_code}
              </span>
            )}
            {isEmergencySquawk(hoveredAircraft.aircraft.squawk) && (
              <span className="px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse">
                SQK {hoveredAircraft.aircraft.squawk}
              </span>
            )}
          </div>
          {hoveredAircraft.aircraft.aircraft_model && (
            <div className="mt-0.5 text-[11px] text-white font-semibold">
              {hoveredAircraft.aircraft.aircraft_model}
            </div>
          )}
          <div className="mt-1 text-slate-300 flex items-center gap-3">
            <span>ALT: {metersToFeet(hoveredAircraft.aircraft.renderAlt).toLocaleString()} ft</span>
            <span>GS: {msToKnots(hoveredAircraft.aircraft.velocity)} kts</span>
            <span>HDG: {Math.round(hoveredAircraft.aircraft.renderTrack)}°</span>
          </div>
        </div>
      )}
    </div>
  );
};
