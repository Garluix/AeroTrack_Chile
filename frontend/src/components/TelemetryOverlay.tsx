import React, { useMemo } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  Activity,
  AlertOctagon,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { useFlightStore } from '../store/useFlightStore';
import { KinematicAircraft } from '../types/telemetry';
import { isEmergencySquawk } from '../utils/kinematics';
import { TopBar } from './TopBar';

interface TelemetryOverlayProps {
  onTriggerDemoEmergency: (squawk: '7500' | '7600' | '7700' | '1200') => void;
}

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({
  onTriggerDemoEmergency,
}) => {
  const metrics = useFlightStore((s) => s.metrics);
  const batchVersion = useFlightStore((s) => s.batchVersion);
  const showFIRBoundaries = useFlightStore((s) => s.showFIRBoundaries);
  const setShowFIRBoundaries = useFlightStore((s) => s.setShowFIRBoundaries);
  const flyTo = useFlightStore((s) => s.flyTo);
  const setSelectedIcao24 = useFlightStore((s) => s.setSelectedIcao24);

  const emergencyList = useMemo(() => {
    void batchVersion;
    const map = useFlightStore.getState().kinematicMap;
    const alerts: KinematicAircraft[] = [];
    for (const ac of map.values()) {
      if (isEmergencySquawk(ac.squawk)) {
        alerts.push(ac);
      }
    }
    return alerts;
  }, [batchVersion]);

  return (
    <>
      {/* Top Bar + Left Tactical Controls Stack (No Overlap) */}
      <div className="fixed top-3 left-3 right-3 z-20 pointer-events-none flex flex-col items-start gap-2.5">
        <TopBar />

        <div className="pointer-events-auto flex flex-col gap-2.5 w-72">
          {/* Emergency Squawk Active Alert Panel */}
          {emergencyList.length > 0 && (
            <div className="p-3 rounded-2xl bg-red-950/85 backdrop-blur-xl border border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.4)] text-red-100">
              <div className="flex items-center justify-between text-xs font-mono font-bold uppercase tracking-wider text-red-300 mb-2">
                <span className="flex items-center gap-1.5">
                  <AlertOctagon className="w-4 h-4 text-red-400 animate-bounce" />
                  ALERTA SQUAWK ACTIVA ({emergencyList.length})
                </span>
                <button
                  type="button"
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
                    type="button"
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
              type="button"
              onClick={() => onTriggerDemoEmergency('7700')}
              className="w-full py-1.5 px-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/75 border border-red-500/40 text-red-200 flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-red-400" />
              <span>SIMULAR ALERTA SQUAWK 7700</span>
            </button>
          </div>
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
