import React from 'react';
import { AlertOctagon } from 'lucide-react';
import { useFlightStore } from '../store/useFlightStore';
import { TopBar } from './TopBar';

interface TelemetryOverlayProps {
  onTriggerDemoEmergency: (squawk: '7500' | '7600' | '7700' | '1200') => void;
}

export const TelemetryOverlay: React.FC<TelemetryOverlayProps> = ({
  onTriggerDemoEmergency,
}) => {
  const emergencyList = useFlightStore((s) => s.emergencyList);
  const flyTo = useFlightStore((s) => s.flyTo);
  const setSelectedIcao24 = useFlightStore((s) => s.setSelectedIcao24);

  return (
    <div className="fixed top-3 left-3 right-3 z-20 pointer-events-none flex flex-col items-start gap-2.5">
      <TopBar />

      {emergencyList.length > 0 && (
        <div className="pointer-events-auto w-72 p-3 rounded-2xl bg-red-950/85 backdrop-blur-xl border border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.4)] text-red-100">
          <div className="flex items-center justify-between text-xs font-mono font-bold uppercase tracking-wider text-red-300 mb-2">
            <span className="flex items-center gap-1.5">
              <AlertOctagon className="w-4 h-4 text-red-400 animate-bounce" />
              ALERTA SQUAWK ({emergencyList.length})
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
    </div>
  );
};
