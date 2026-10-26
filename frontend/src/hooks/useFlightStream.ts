import { useEffect, useRef, useCallback } from 'react';
import { useFlightStore } from '../store/useFlightStore';
import { AircraftTelemetry, BoundingBox, FIRDefinition, ServerWSMessage } from '../types/telemetry';

function resolveApiBase(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL as string;
  }
  if (window.location.port === '5173' || window.location.port === '4173') {
    return `${window.location.protocol}//${window.location.hostname}:4000/api`;
  }
  return '/api';
}

const API_BASE = resolveApiBase();

function resolveWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL as string;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (window.location.port === '5173' || window.location.port === '4173') {
    return `${proto}//${window.location.hostname}:4000/ws`;
  }
  return `${proto}//${window.location.host}/ws`;
}

export function useFlightStream() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);

  const ingestTelemetryBatch = useFlightStore((s) => s.ingestTelemetryBatch);
  const setSelectedTrail = useFlightStore((s) => s.setSelectedTrail);
  const setFirs = useFlightStore((s) => s.setFirs);
  const setWsConnected = useFlightStore((s) => s.setWsConnected);
  const updateSystemMetrics = useFlightStore((s) => s.updateSystemMetrics);
  const selectedIcao24 = useFlightStore((s) => s.selectedIcao24);

  // Load Chilean FIR polygon definitions & initial aircraft snapshot on mount
  useEffect(() => {
    fetch(`${API_BASE}/firs`)
      .then((res) => res.json())
      .then((data: { firs?: FIRDefinition[] }) => {
        if (data.firs) {
          setFirs(data.firs);
        }
      })
      .catch(() => {
        // Fallback FIRs if API is still warming up
      });

    fetch(`${API_BASE}/flights`)
      .then((res) => res.json())
      .then((data: { aircraft?: AircraftTelemetry[]; source?: string }) => {
        if (Array.isArray(data.aircraft) && data.aircraft.length > 0) {
          const state = useFlightStore.getState();
          if (state.kinematicMap.size === 0) {
            ingestTelemetryBatch(
              undefined,
              data.aircraft,
              [],
              state.metrics.activeBbox,
              state.metrics.activeGeohashes,
              (data.source as 'adsbfi' | 'opensky' | 'hybrid' | 'synthetic') || 'adsbfi',
              data.aircraft.length
            );
          }
        }
      })
      .catch(() => {
        // WebSocket stream will populate telemetry
      });
  }, [setFirs, ingestTelemetryBatch]);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const ws = new WebSocket(resolveWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setWsConnected(true);

      // Re-subscribe to selected aircraft if any
      const currentSelected = useFlightStore.getState().selectedIcao24;
      if (currentSelected) {
        ws.send(
          JSON.stringify({
            type: 'subscribe_aircraft',
            icao24: currentSelected,
          })
        );
      }

      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));
        }
      }, 4000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerWSMessage;
        switch (msg.type) {
          case 'telemetry_batch':
            ingestTelemetryBatch(
              msg.tuples,
              msg.aircraft,
              msg.removedIds,
              msg.activeBbox,
              msg.geohashPrefixes,
              msg.source,
              msg.totalGlobalCount
            );
            break;

          case 'aircraft_trail':
            setSelectedTrail(msg.icao24, msg.trail);
            break;

          case 'system_metrics':
            updateSystemMetrics({
              connectedClients: msg.connectedClients,
              totalTrackedAircraft: msg.totalTrackedAircraft,
              upstreamSource: msg.upstreamSource,
              rateLimitRemaining: msg.rateLimitRemaining,
              redisConnected: msg.redisConnected,
              pollingIntervalMs: msg.pollingIntervalMs,
              activeBbox: msg.activeBbox,
            });
            break;

          case 'pong': {
            const rtt = Math.max(1, Math.round(performance.now() - msg.clientTime));
            updateSystemMetrics({ wsLatencyMs: rtt });
            break;
          }
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      if (pingIntervalRef.current) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      const attempt = reconnectAttemptRef.current++;
      const delayMs = Math.min(10000, 800 * Math.pow(1.8, attempt));
      reconnectTimerRef.current = window.setTimeout(connectWebSocket, delayMs);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [ingestTelemetryBatch, setSelectedTrail, setWsConnected, updateSystemMetrics]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  // Notify backend whenever selected aircraft changes to stream its historical breadcrumb trail
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'subscribe_aircraft',
          icao24: selectedIcao24,
        })
      );
    }
    if (selectedIcao24) {
      fetch(`${API_BASE}/flights/${selectedIcao24}/trail`)
        .then((r) => r.json())
        .then((data: { icao24?: string; trail?: [] }) => {
          if (data.icao24 && Array.isArray(data.trail)) {
            setSelectedTrail(data.icao24, data.trail);
          }
        })
        .catch(() => {});
    }
  }, [selectedIcao24, setSelectedTrail]);

  const emitViewportChanged = useCallback((bbox: BoundingBox, zoom: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'viewport_changed',
          bbox,
          zoom,
        })
      );
    }
  }, []);

  const injectEmergencySquawk = useCallback(
    (squawk: '7500' | '7600' | '7700' | '1200', icao24?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'inject_emergency_test',
            icao24,
            squawk,
          })
        );
      }
      // Optimistically update local kinematic map for immediate visual response
      const map = useFlightStore.getState().kinematicMap;
      const targetId = icao24 || useFlightStore.getState().selectedIcao24 || map.keys().next().value;
      if (targetId && map.has(targetId)) {
        const ac = map.get(targetId)!;
        ac.squawk = squawk;
        useFlightStore.getState().syncSelectedSnapshot();
      }
    },
    []
  );

  return {
    emitViewportChanged,
    injectEmergencySquawk,
  };
}
