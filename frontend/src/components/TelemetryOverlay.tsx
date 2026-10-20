import React, { useMemo } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  Activity,
  AlertOctagon,
  Cpu,
  Database,
  Globe,
  MapPin,
  Plane,
  Radar,
  Search,
  Sparkles,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useFlightStore } from '../store/useFlightStore';
import { AircraftFilterType, ChileanFIRCode, KinematicAircraft } from '../types/telemetry';
import { isEmergencySquawk } from '../utils/kinematics';

interface TelemetryOverlayProps {
  onTriggerDemoEmergency: (squawk: '7500' | '7600' | '7700' | '1200') => void;
}

const FIR_PRESETS: Array<{
  code: ChileanFIRCode | 'ALL';
  label: string;
  sub: string;
  lat: number;
  lon: number;
  zoom: number;
}> = [
  { code: 'ALL', label: 'CHILE GLOBAL', sub: 'Convergencia FIRs', lat: -33.4489, lon: -70.6693, zoom: 6.0 },
  { code: 'SCFA', label: 'FIR SCFA', sub: 'Antofagasta', lat: -23.444, lon: -70.399, zoom: 6.2 },
  { code: 'SCEZ', label: 'FIR SCEZ', sub: 'Santiago Central', lat: -33.4489, lon: -70.6693, zoom: 6.8 },
  { code: 'SCTE', label: 'FIR SCTE', sub: 'Puerto Montt', lat: -41.438, lon: -73.094, zoom: 6.4 },
  { code: 'SCCF', label: 'FIR SCCF', sub: 'Punta Arenas', lat: -52.5, lon: -70.85, zoom: 6.0 },
  { code: 'SCIP', label: 'FIR SCIP', sub: 'Rapa Nui Oceánico', lat: -27.164, lon: -109.421, zoom: 5.2 },
];

const CATEGORY_FILTER_OPTIONS: Array<{
  type: AircraftFilterType;
  label: string;
}> = [
  { type: 'all', label: 'TODOS' },
  { type: 'planes', label: 'AVIONES' },
  { type: 'helicopters', label: 'HELICÓPTEROS' },
];

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({
  onTriggerDemoEmergency,
}) => {
  const wsConnected = useFlightStore((s) => s.wsConnected);
  const metrics = useFlightStore((s) => s.metrics);
  const batchVersion = useFlightStore((s) => s.batchVersion);
  const filterType = useFlightStore((s) => s.filterType);
  const setFilterType = useFlightStore((s) => s.setFilterType);
  const activeFIRFilter = useFlightStore((s) => s.activeFIRFilter);
  const setActiveFIRFilter = useFlightStore((s) => s.setActiveFIRFilter);
  const showFIRBoundaries = useFlightStore((s) => s.showFIRBoundaries);
  const setShowFIRBoundaries = useFlightStore((s) => s.setShowFIRBoundaries);
  const searchQuery = useFlightStore((s) => s.searchQuery);
  const setSearchQuery = useFlightStore((s) => s.setSearchQuery);
  const flyTo = useFlightStore((s) => s.flyTo);
  const setSelectedIcao24 = useFlightStore((s) => s.setSelectedIcao24);

  // Compute live category counts & active emergency squawk list from the authoritative kinematic map
  const { emergencyList, categoryCounts } = useMemo(() => {
    void batchVersion;
    const map = useFlightStore.getState().kinematicMap;
    const alerts: KinematicAircraft[] = [];
    let all = 0;
    let planes = 0;
    let helicopters = 0;

    for (const ac of map.values()) {
      if (isEmergencySquawk(ac.squawk)) {
        alerts.push(ac);
      }
      if (activeFIRFilter !== 'ALL' && ac.fir !== activeFIRFilter) {
        continue;
      }
      all++;
      if (ac.isHelicopter) {
        helicopters++;
      } else {
        planes++;
      }
    }

    if (activeFIRFilter === 'ALL' && metrics.totalTrackedAircraft > all) {
      const delta = metrics.totalTrackedAircraft - all;
      all += delta;
      planes += delta;
    }

    return {
      emergencyList: alerts,
      categoryCounts: { all, planes, helicopters },
    };
  }, [batchVersion, activeFIRFilter, metrics.totalTrackedAircraft]);

  const activeTrafficCount =
    filterType === 'planes'
      ? categoryCounts.planes
      : filterType === 'helicopters'
      ? categoryCounts.helicopters
      : categoryCounts.all;

  return (
    <>
      {/* Top Tactical Command Bar */}
      <header className="fixed top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-950/80 backdrop-blur-xl border border-slate-800/90 shadow-[0_8px_32px_rgba(0,0,0,0.55)]">
        {/* Brand & Operational Status */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <Radar className="w-5 h-5 text-cyan-400 animate-spin" style={{ animationDuration: '8s' }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wider uppercase text-white">
                AeroTrack <span className="text-cyan-400">Chile</span>
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                DGAC FIR TELEMETRY
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-400">
              SCEZ · SCFA · SCTE · SCCF · SCIP | Dead Reckoning 60 FPS
            </p>
          </div>
        </div>

        {/* Search & Filter Input */}
        <div className="relative w-56">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar Callsign, ICAO24, Squawk..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 focus:border-cyan-500/60 text-xs font-mono text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
          />
        </div>

        {/* Three-Category Tactical Segmented Control: [TODOS] [AVIONES] [HELICÓPTEROS] */}
        <div
          role="group"
          aria-label="Filtro de categoría de aeronave"
          className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800 font-mono text-[11px]"
        >
          {CATEGORY_FILTER_OPTIONS.map((opt) => {
            const isActive = filterType === opt.type;
            const count =
              opt.type === 'all'
                ? categoryCounts.all
                : opt.type === 'planes'
                ? categoryCounts.planes
                : categoryCounts.helicopters;
            return (
              <button
                key={opt.type}
                onClick={() => setFilterType(opt.type)}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/70 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <span>[{opt.label}]</span>
                <span
                  className={`text-[10px] px-1 rounded ${
                    isActive
                      ? 'bg-cyan-500/25 text-cyan-100'
                      : 'bg-slate-800/80 text-slate-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* FIR Quick-Jump & Sector Selector */}
        <div className="hidden 2xl:flex items-center gap-1.5">
          {FIR_PRESETS.map((preset) => {
            const active = activeFIRFilter === preset.code;
            return (
              <button
                key={preset.code}
                onClick={() => {
                  setActiveFIRFilter(preset.code);
                  flyTo({ lat: preset.lat, lon: preset.lon, zoom: preset.zoom });
                }}
                className={`px-2.5 py-1 rounded-xl text-left font-mono transition-all border ${
                  active
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="text-[11px] font-bold leading-tight">{preset.label}</div>
                <div className="text-[9px] text-slate-400 leading-tight">{preset.sub}</div>
              </button>
            );
          })}

          <button
            onClick={() => {
              setActiveFIRFilter('ALL');
              flyTo({ lat: 38.5, lon: -96.5, zoom: 4.1, pitch: 0 });
            }}
            className="px-2.5 py-1 rounded-xl bg-slate-900/70 hover:bg-slate-800 border border-slate-800 text-slate-300 font-mono text-[11px] flex items-center gap-1 transition-colors"
            title="Vista Continental EE.UU. (Alta Densidad FAA/ADS-B)"
          >
            <Plane className="w-3.5 h-3.5 text-amber-400" />
            <span>EE.UU.</span>
          </button>

          <button
            onClick={() => {
              setActiveFIRFilter('ALL');
              flyTo({ lat: 15.0, lon: -30.0, zoom: 2.1, pitch: 0 });
            }}
            className="px-2.5 py-1 rounded-xl bg-slate-900/70 hover:bg-slate-800 border border-slate-800 text-slate-300 font-mono text-[11px] flex items-center gap-1 transition-colors"
            title="Vista Global Slippy Map"
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>GLOBAL</span>
          </button>
        </div>

        {/* Live Telemetry Metrics Readout */}
        <div className="flex items-center gap-2.5 font-mono text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800">
            <Plane className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400">TRÁFICO:</span>
            <span className="font-bold text-white">{activeTrafficCount}</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-bold text-emerald-300">{metrics.fps}</span>
            <span className="text-slate-400">FPS</span>
          </div>

          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800">
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-slate-400">GEOHASH:</span>
            <span className="text-indigo-300">{metrics.activeGeohashes.length} celdas</span>
          </div>

          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border ${
              wsConnected
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                : 'bg-red-950/60 border-red-500/50 text-red-300'
            }`}
          >
            {wsConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span>WS {metrics.wsLatencyMs}ms</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
                <span>RECONECTANDO</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Left Tactical Controls & Emergency Squawk Alert Ticker */}
      <div className="fixed top-20 left-3 z-20 flex flex-col gap-2.5 w-72">
        {/* Emergency Squawk Active Alert Panel */}
        {emergencyList.length > 0 && (
          <div className="p-3 rounded-2xl bg-red-950/85 backdrop-blur-xl border border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.4)] text-red-100">
            <div className="flex items-center justify-between text-xs font-mono font-bold uppercase tracking-wider text-red-300 mb-2">
              <span className="flex items-center gap-1.5">
                <AlertOctagon className="w-4 h-4 text-red-400 animate-bounce" />
                ALERTA SQUAWK ACTIVA ({emergencyList.length})
              </span>
              <button
                onClick={() => onTriggerDemoEmergency('1200')}
                className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/80 hover:bg-red-800 text-red-200 border border-red-500/40"
              >
                LIMPIAR
              </button>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {emergencyList.map((ac) => (
                <button
                  key={ac.icao24}
                  onClick={() => {
                    setSelectedIcao24(ac.icao24);
                    flyTo({ lat: ac.renderLat, lon: ac.renderLon, zoom: 7.5, pitch: 35 });
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-red-900/50 hover:bg-red-900/80 border border-red-500/40 text-xs font-mono transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{ac.callsign}</span>
                    <span className="text-[10px] text-red-200">{ac.fir}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-bold animate-pulse">
                    SQK {ac.squawk}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Spatial & Cartographic Layer Controls */}
        <div className="p-3 rounded-2xl bg-slate-950/78 backdrop-blur-xl border border-slate-800/90 text-xs font-mono space-y-2.5 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              LÍMITES FIR DGAC CHILE
            </span>
            <Switch.Root
              checked={showFIRBoundaries}
              onCheckedChange={setShowFIRBoundaries}
              className="w-8 h-4 bg-slate-800 rounded-full relative data-[state=checked]:bg-cyan-500 transition-colors cursor-pointer"
            >
              <Switch.Thumb className="block w-3 h-3 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-4" />
            </Switch.Root>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>INGESTA:</span>
            <span className="flex items-center gap-1.5 uppercase text-emerald-300 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              ADS-B REAL EN VIVO ({metrics.upstreamSource} · {metrics.pollingIntervalMs / 1000}s)
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>BBOX ACTIVO:</span>
            <span className="text-slate-300">
              [{metrics.activeBbox.lamin.toFixed(0)}°, {metrics.activeBbox.lomin.toFixed(0)}°] → [
              {metrics.activeBbox.lamax.toFixed(0)}°, {metrics.activeBbox.lomax.toFixed(0)}°]
            </span>
          </div>

          <button
            onClick={() => onTriggerDemoEmergency('7700')}
            className="w-full py-1.5 px-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/75 border border-red-500/40 text-red-200 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-red-400" />
            <span>SIMULAR ALERTA SQUAWK 7700</span>
          </button>
        </div>
      </div>

      {/* Bottom Altitude Spectrum Legend */}
      <footer className="fixed bottom-3 left-3 z-20 px-3.5 py-2 rounded-2xl bg-slate-950/80 backdrop-blur-xl border border-slate-800/90 flex items-center gap-4 text-[11px] font-mono text-slate-300 shadow-lg">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">PERFIL DE ALTITUD:</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-emerald-400">0 ft</span>
          <div className="w-36 h-2 rounded-full bg-gradient-to-r from-emerald-500 via-cyan-400 via-indigo-400 to-pink-500" />
          <span className="text-pink-400">FL410+</span>
        </div>
        <span className="hidden sm:inline text-slate-500">|</span>
        <span className="hidden sm:inline text-slate-400">
          INTERPOLACIÓN: <strong className="text-cyan-300">GREAT CIRCLE SLERP + EXP DECAY</strong>
        </span>
      </footer>
    </>
  );
};
