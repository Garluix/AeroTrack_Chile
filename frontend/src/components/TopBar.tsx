import React, { useState } from 'react';
import {
  Cpu,
  Globe,
  MapPin,
  Plane,
  Radar,
  Search,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useFlightStore } from '../store/useFlightStore';
import { AircraftFilterType } from '../types/telemetry';

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
  const categoryCounts = useFlightStore((s) => s.categoryCounts);
  const filterType = useFlightStore((s) => s.filterType) || 'all';
  const setFilterType = useFlightStore((s) => s.setFilterType);
  const setActiveFIRFilter = useFlightStore((s) => s.setActiveFIRFilter);
  const searchQuery = useFlightStore((s) => s.searchQuery);
  const setSearchQuery = useFlightStore((s) => s.setSearchQuery);
  const flyTo = useFlightStore((s) => s.flyTo);

  const [activeView, setActiveView] = useState<'chile' | 'world'>('chile');

  const activeTrafficCount =
    filterType === 'planes'
      ? categoryCounts.planes
      : filterType === 'helicopters'
      ? categoryCounts.helicopters
      : categoryCounts.all;

  const handleFocusChile = () => {
    setActiveView('chile');
    setActiveFIRFilter('ALL');
    flyTo({
      lat: -35.6751,
      lon: -71.543,
      zoom: 4.5,
      pitch: 0,
      bearing: 0,
    });
  };

  const handleFocusWorld = () => {
    setActiveView('world');
    setActiveFIRFilter('ALL');
    flyTo({
      lat: 0,
      lon: 0,
      zoom: 1.5,
      pitch: 0,
      bearing: 0,
    });
  };

  return (
    <header className="pointer-events-auto w-full flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-slate-800/90 shadow-[0_8px_32px_rgba(0,0,0,0.65)]">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.3)]">
          <Radar className="w-4 h-4 text-cyan-400 animate-spin" style={{ animationDuration: '8s' }} />
        </div>
        <h1 className="text-sm font-bold tracking-wider uppercase text-white">
          AeroTrack <span className="text-cyan-400">Chile</span>
        </h1>
      </div>

      {/* Search + Category Filter [TODOS | AVIONES | HELICÓPTEROS] + Quick View [CHILE | MUNDO] */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search Input */}
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

        {/* 3-Category Segmented Filter: [TODOS] | [AVIONES] | [HELICÓPTEROS] */}
        <div
          role="group"
          aria-label="Filtro de categoría de aeronave"
          className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/95 border border-slate-700/90 font-mono text-[11px]"
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

        {/* Quick View Controls: [CHILE] | [MUNDO] */}
        <div
          role="group"
          aria-label="Controles de vista rápida"
          className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/95 border border-slate-700/90 font-mono text-[11px]"
        >
          <button
            type="button"
            onClick={handleFocusChile}
            className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              activeView === 'chile'
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/80 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span>[CHILE]</span>
          </button>

          <button
            type="button"
            onClick={handleFocusWorld}
            className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
              activeView === 'world'
                ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/80 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>[MUNDO]</span>
          </button>
        </div>
      </div>

      {/* Essential Telemetry Indicators (Active Traffic, FPS, WS Status) */}
      <div className="flex items-center gap-2 font-mono text-xs">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800">
          <Plane className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">TRÁFICO:</span>
          <span className="font-bold text-white">{activeTrafficCount}</span>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800">
          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-bold text-emerald-300">{metrics.fps}</span>
          <span className="text-slate-400">FPS</span>
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
              <span>OFFLINE</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
