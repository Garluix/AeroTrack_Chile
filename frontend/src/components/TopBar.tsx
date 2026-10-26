import React, { useMemo } from 'react';
import {
  Cpu,
  Database,
  Globe,
  Plane,
  Radar,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useFlightStore } from '../store/useFlightStore';
import { AircraftFilterType, ChileanFIRCode } from '../types/telemetry';

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

export const TopBar: React.FC = () => {
  const wsConnected = useFlightStore((s) => s.wsConnected);
  const metrics = useFlightStore((s) => s.metrics);
  const batchVersion = useFlightStore((s) => s.batchVersion);
  const filterType = useFlightStore((s) => s.filterType) || 'all';
  const setFilterType = useFlightStore((s) => s.setFilterType);
  const activeFIRFilter = useFlightStore((s) => s.activeFIRFilter);
  const setActiveFIRFilter = useFlightStore((s) => s.setActiveFIRFilter);
  const searchQuery = useFlightStore((s) => s.searchQuery);
  const setSearchQuery = useFlightStore((s) => s.setSearchQuery);
  const flyTo = useFlightStore((s) => s.flyTo);

  const categoryCounts = useMemo(() => {
    void batchVersion;
    const map = useFlightStore.getState().kinematicMap;
    let all = 0;
    let planes = 0;
    let helicopters = 0;

    for (const ac of map.values()) {
      if (activeFIRFilter !== 'ALL' && ac.fir !== activeFIRFilter) {
        continue;
      }
      all++;
      if (ac.isHelicopter === true) {
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

    return { all, planes, helicopters };
  }, [batchVersion, activeFIRFilter, metrics.totalTrackedAircraft]);

  const activeTrafficCount =
    filterType === 'planes'
      ? categoryCounts.planes
      : filterType === 'helicopters'
      ? categoryCounts.helicopters
      : categoryCounts.all;

  return (
    <header className="pointer-events-auto w-full flex flex-col gap-2 px-4 py-2.5 rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-slate-800/90 shadow-[0_8px_32px_rgba(0,0,0,0.65)]">
      {/* Row 1: Brand, Search, [TODOS | AVIONES | HELICÓPTEROS] Filter & Live Telemetry Counters */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
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
              SCEZ · SCFA · SCTE · SCCF · SCIP | Dead Reckoning 60/120 FPS
            </p>
          </div>
        </div>

        {/* Search Input + 3-Category Segmented Selector [TODOS | AVIONES | HELICÓPTEROS] */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-52 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrar Callsign, ICAO24, Squawk..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 focus:border-cyan-500/60 text-xs font-mono text-slate-100 placeholder:text-slate-500 outline-none transition-colors"
            />
          </div>

          <div
            role="group"
            aria-label="Filtro de categoría de aeronave"
            className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/95 border border-slate-700/90 font-mono text-[11px] shadow-inner"
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
                  type="button"
                  onClick={() => setFilterType(opt.type)}
                  className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/80 font-bold shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <span>[{opt.label}]</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      isActive
                        ? 'bg-cyan-500/30 text-cyan-100'
                        : 'bg-slate-800/90 text-slate-400'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Telemetry Metrics Readout */}
        <div className="flex items-center gap-2 font-mono text-xs">
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

          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800">
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
      </div>

      {/* Row 2: FIR Quick-Jump & Global Sector Selector */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-800/70">
        {FIR_PRESETS.map((preset) => {
          const active = activeFIRFilter === preset.code;
          return (
            <button
              key={preset.code}
              type="button"
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
          type="button"
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
          type="button"
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
    </header>
  );
};
