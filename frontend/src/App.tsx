import React from 'react';
import { FlightMap } from './components/FlightMap';
import { FlightHUD } from './components/FlightHUD';
import { TelemetryOverlay } from './components/TelemetryOverlay';
import { useFlightStream } from './hooks/useFlightStream';

export const App: React.FC = () => {
  const { emitViewportChanged, injectEmergencySquawk } = useFlightStream();

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950">
      <FlightMap onViewportChanged={emitViewportChanged} />
      <TelemetryOverlay
        onTriggerDemoEmergency={(squawk) => injectEmergencySquawk(squawk)}
      />
      <FlightHUD onSimulateSquawk={injectEmergencySquawk} />
    </main>
  );
};

export default App;
