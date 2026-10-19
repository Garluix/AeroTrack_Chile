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

type BasemapMode = 'osm-dark' | 'osm-clear' | 'maplibre-vector';

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

  const [basemapMode, setBasemapMode] = useState<BasemapMode>('osm-dark');
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

    const emitBounds = () => {
      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current);
      }
      viewportDebounceRef.current = window.setTimeout(() => {
        const bounds = map.getBounds();
        onViewportChanged(
          {
            lamin: Number(bounds.getSouth().toFixed(3)),
            lomin: Number(bounds.getWest().toFixed(3)),
            lamax: Number(bounds.getNorth().toFixed(3)),
            lomax: Number(bounds.getEast().toFixed(3)),
          },
          Number(map.getZoom().toFixed(2))
        );
      }, 280);
    };

    map.on('load', emitBounds);
    map.on('moveend', emitBounds);

    mapRef.current = map;
    deckOverlayRef.current = deckOverlay;

    return () => {
      if (viewportDebounceRef.current) window.clearTimeout(viewportDebounceRef.current);
      map.remove();
      mapRef.current = null;
      deckOverlayRef.current = null;
    };
  }, [onViewportChanged]);

  // Switch between OpenStreetMap Dark Radar, OpenStreetMap Standard, and MapLibre Demo Vector Style
  const handleSelectBasemap = (mode: BasemapMode) => {
    setBasemapMode(mode);
    if (!mapRef.current) return;
    if (mode === 'maplibre-vector') {
      mapRef.current.setStyle('https://demotiles.maplibre.org/style.json');
    } else if (mode === 'osm-clear') {
      mapRef.current.setStyle(buildOpenStreetMapStyle(false));
    } else {
      mapRef.current.setStyle(buildOpenStreetMapStyle(true));
    }
  };

  // Smooth camera transitions when user selects a FIR sector or Global preset
  useEffect(() => {
    if (!cameraTarget || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [cameraTarget.lon, cameraTarget.lat],
      zoom: cameraTarget.zoom,
      pitch: cameraTarget.pitch ?? 18,
      bearing: cameraTarget.bearing ?? 0,
      duration: 1600,
      essential: true,
    });
  }, [cameraTarget]);

  // 60 FPS Kinematic Dead Reckoning loop updating Deck.gl WebGL layers directly
  useDeadReckoning((aircraftList, pulsePhase, frameTimeMs) => {
    const overlay = deckOverlayRef.current;
    if (!overlay) return;

    const state = useFlightStore.getState();
    const selectedId = state.selectedIcao24;
    const firs = state.firs;
    const showFIRs = state.showFIRBoundaries;
    const trail = state.selectedTrail;

    // Follow selected aircraft smoothly if lock-on mode is active
    if (state.followSelectedAircraft && selectedId && mapRef.current) {
      const tracked = state.kinematicMap.get(selectedId);
      if (tracked) {
        mapRef.current.jumpTo({
          center: [tracked.renderLon, tracked.renderLat],
        });
      }
    }

    // Build altitude-graded geodesic trail segments for the selected aircraft
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

      // 4. High-Performance WebGL Aircraft IconLayer rotated around exact center pivot
      new IconLayer<KinematicAircraft>({
        id: 'aircraft-kinematic-icon-layer',
        data: aircraftList,
        pickable: true,
        iconAtlas: AIRCRAFT_ICON_ATLAS,
        iconMapping: AIRCRAFT_ICON_MAPPING,
        getIcon: () => 'aircraft',
        sizeScale: 1,
        sizeUnits: 'pixels',
        sizeMinPixels: 20,
        sizeMaxPixels: 38,
        billboard: false,
        getPosition: (d) => [d.renderLon, d.renderLat],
        getSize: (d) =>
          d.icao24 === selectedId
            ? 32
            : isEmergencySquawk(d.squawk)
            ? 30
            : 24,
        getAngle: (d) => (360 - d.renderTrack) % 360,
        getColor: (d) =>
          getAltitudeColorRGBA(
            d.renderAlt,
            d.squawk,
            d.icao24 === selectedId,
            pulsePhase
          ),
        onHover: (info: PickingInfo<KinematicAircraft>) => {
          if (info.object) {
            setHoveredAircraft({
              x: info.x,
              y: info.y,
              aircraft: info.object,
            });
          } else {
            setHoveredAircraft(null);
          }
        },
        onClick: (info: PickingInfo<KinematicAircraft>) => {
          if (info.object) {
            setSelectedIcao24(info.object.icao24);
          }
        },
        updateTriggers: {
          getPosition: frameTimeMs,
          getAngle: frameTimeMs,
          getColor: [frameTimeMs, selectedId],
          getSize: [selectedId],
        },
      }),
    ];

    overlay.setProps({ layers });
  });

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      <div
        ref={mapContainerRef}
        className="w-full h-full cursor-crosshair"
      />

      {/* Basemap Selector (OpenStreetMap Raster / MapLibre Vector Demo - Zero CartoDB URLs) */}
      <div className="fixed bottom-3 right-14 z-20 flex items-center gap-1 p-1 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 text-[11px] font-mono shadow-lg">
        <button
          onClick={() => handleSelectBasemap('osm-dark')}
          className={`px-2.5 py-1 rounded-lg transition-colors ${
            basemapMode === 'osm-dark'
              ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          OSM Radar
        </button>
        <button
          onClick={() => handleSelectBasemap('osm-clear')}
          className={`px-2.5 py-1 rounded-lg transition-colors ${
            basemapMode === 'osm-clear'
              ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          OSM Claro
        </button>
        <button
          onClick={() => handleSelectBasemap('maplibre-vector')}
          className={`px-2.5 py-1 rounded-lg transition-colors ${
            basemapMode === 'maplibre-vector'
              ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          MapLibre Vector
        </button>
      </div>

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
