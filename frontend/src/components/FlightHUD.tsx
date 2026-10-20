import React, { useEffect, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Camera,
  Compass,
  Crosshair,
  ExternalLink,
  Gauge,
  Globe2,
  Layers,
  Minus,
  Navigation,
  Plane,
  Radio,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useFlightStore } from '../store/useFlightStore';
import { AircraftPhotoMetadata, AirframeCategory } from '../types/telemetry';
import {
  getSquawkAlertInfo,
  metersToFeet,
  msToFeetPerMin,
  msToKmh,
  msToKnots,
  msToMach,
} from '../utils/kinematics';

interface FlightHUDProps {
  onSimulateSquawk: (squawk: '7500' | '7600' | '7700' | '1200', icao24?: string) => void;
}

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

/**
 * Vector SVG silhouette placeholder tailored to the aircraft category:
 * - 'helicopter' (Ala Rotatoria: Bell 206/407/412, Airbus H125/H135/H145, UH-60, AW139, Robinson R44)
 * - 'twin-jet' (Jet Bimotor: A320, A321neo, B737, B787 Dreamliner)
 * - 'quad-jet' (Cuatrimotor: B747, A340, A380, BAe 146)
 * - 'turboprop' (Turbohélice / Pistón: ATR 72, Dash 8, King Air, Cessna, C-130)
 */
const AirframeCategorySilhouette: React.FC<{
  category: AirframeCategory;
  code: string;
  model: string;
}> = ({ category, code, model }) => {
  const categoryLabel =
    category === 'helicopter'
      ? 'SILUETA TÁCTICA · ALA ROTATORIA / HELICÓPTERO'
      : category === 'quad-jet'
      ? 'SILUETA TÁCTICA · CUATRIMOTOR PESADO'
      : category === 'turboprop'
      ? 'SILUETA TÁCTICA · TURBOHÉLICE / REGIONAL'
      : 'SILUETA TÁCTICA · JET BIMOTOR';

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-slate-900/95 border border-cyan-500/25 flex flex-col items-center justify-center p-3 select-none">
      {/* Subtle blueprint grid background */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(to right, #06b6d4 1px, transparent 1px), linear-gradient(to bottom, #06b6d4 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />

      <div className="absolute top-2 left-2.5 flex items-center gap-1.5 text-[10px] font-mono text-cyan-400/80">
        <Plane className="w-3 h-3" />
        <span>{categoryLabel}</span>
      </div>

      <div className="absolute top-2 right-2.5 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-300">
        {code}
      </div>

      {/* Category-specific vector blueprint SVG */}
      {category === 'helicopter' ? (
        <svg viewBox="0 0 260 120" className="w-44 h-24 text-emerald-400/85 drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]">
          {/* Landing skids */}
          <line x1="112" y1="28" x2="112" y2="62" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="148" y1="28" x2="148" y2="62" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="112" y1="38" x2="122" y2="38" stroke="currentColor" strokeWidth="2" />
          <line x1="138" y1="38" x2="148" y2="38" stroke="currentColor" strokeWidth="2" />
          <line x1="112" y1="54" x2="122" y2="54" stroke="currentColor" strokeWidth="2" />
          <line x1="138" y1="54" x2="148" y2="54" stroke="currentColor" strokeWidth="2" />
          {/* Cabin + tail boom + stabilizer */}
          <path
            d="M130 18 C140 18 143 32 142 48 C141 58 136 66 133 70 L132 98 L146 98 L146 103 L132 103 L132 109 L128 109 L128 103 L114 103 L114 98 L128 98 L127 70 C124 66 119 58 118 48 C117 32 120 18 130 18 Z"
            fill="rgba(16,185,129,0.18)"
            stroke="currentColor"
            strokeWidth="2"
          />
          {/* Main rotor disc & 4-blade cross */}
          <circle cx="130" cy="45" r="38" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="101" y1="16" x2="159" y2="74" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="159" y1="16" x2="101" y2="74" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="130" cy="45" r="5" fill="currentColor" />
        </svg>
      ) : category === 'quad-jet' ? (
        <svg viewBox="0 0 260 120" className="w-44 h-24 text-cyan-400/80 drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
          <path
            d="M130 8 C135 18 137 32 137 46 L232 76 L232 84 L137 68 L136 96 L166 108 L166 114 L130 106 L94 114 L94 108 L124 96 L123 68 L28 84 L28 76 L123 46 C123 32 125 18 130 8 Z"
            fill="rgba(6,182,212,0.15)"
            stroke="currentColor"
            strokeWidth="2"
          />
          {/* 4 Engine pods */}
          <rect x="65" y="62" width="7" height="15" rx="2" fill="currentColor" />
          <rect x="92" y="54" width="7" height="16" rx="2" fill="currentColor" />
          <rect x="161" y="54" width="7" height="16" rx="2" fill="currentColor" />
          <rect x="188" y="62" width="7" height="15" rx="2" fill="currentColor" />
        </svg>
      ) : category === 'turboprop' ? (
        <svg viewBox="0 0 260 120" className="w-44 h-24 text-emerald-400/80 drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]">
          <path
            d="M130 12 C134 20 135 34 135 48 L226 52 L226 61 L135 60 L134 96 L162 104 L162 110 L130 105 L98 110 L98 104 L126 96 L125 60 L34 61 L34 52 L125 48 C125 34 126 20 130 12 Z"
            fill="rgba(16,185,129,0.15)"
            stroke="currentColor"
            strokeWidth="2"
          />
          {/* Turboprop nacelles & propeller discs */}
          <rect x="88" y="42" width="8" height="18" rx="2" fill="currentColor" />
          <rect x="164" y="42" width="8" height="18" rx="2" fill="currentColor" />
          <line x1="80" y1="41" x2="104" y2="41" stroke="currentColor" strokeWidth="2.5" />
          <line x1="156" y1="41" x2="180" y2="41" stroke="currentColor" strokeWidth="2.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 260 120" className="w-44 h-24 text-cyan-400/85 drop-shadow-[0_0_10px_rgba(6,182,212,0.3)]">
          <path
            d="M130 10 C135 20 136 34 136 48 L222 74 L222 82 L136 66 L135 96 L162 107 L162 113 L130 106 L98 113 L98 107 L125 96 L124 66 L38 82 L38 74 L124 48 C124 34 125 20 130 10 Z"
            fill="rgba(6,182,212,0.16)"
            stroke="currentColor"
            strokeWidth="2"
          />
          {/* 2 Twin-jet high-bypass turbofan nacelles */}
          <rect x="92" y="54" width="8" height="16" rx="2.5" fill="currentColor" />
          <rect x="160" y="54" width="8" height="16" rx="2.5" fill="currentColor" />
        </svg>
      )}

      <div className="mt-1 text-[11px] font-mono text-slate-300 font-semibold truncate max-w-full">
        {model}
      </div>
      <div className="text-[9px] font-mono text-slate-500">
        SIN FOTOGRAFÍA REGISTRADA EN PLANESPOTTERS
      </div>
    </div>
  );
};

export const FlightHUD: React.FC<FlightHUDProps> = ({ onSimulateSquawk }) => {
  const ac = useFlightStore((s) => s.selectedAircraftSnapshot);
  const trail = useFlightStore((s) => s.selectedTrail);
  const followSelected = useFlightStore((s) => s.followSelectedAircraft);
  const setFollowSelected = useFlightStore((s) => s.setFollowSelectedAircraft);
  const setSelectedIcao24 = useFlightStore((s) => s.setSelectedIcao24);
  const flyTo = useFlightStore((s) => s.flyTo);

  const [photoMeta, setPhotoMeta] = useState<AircraftPhotoMetadata | null>(null);
  const [isLoadingPhoto, setIsLoadingPhoto] = useState<boolean>(false);
  const [imgError, setImgError] = useState<boolean>(false);

  const selectedHex = ac?.icao24 ?? null;

  // Fetch Planespotters photograph & HexDB airframe model whenever a new aircraft is selected
  useEffect(() => {
    if (!selectedHex) {
      setPhotoMeta(null);
      setIsLoadingPhoto(false);
      setImgError(false);
      return;
    }

    let cancelled = false;
    setIsLoadingPhoto(true);
    setImgError(false);

    async function loadAircraftMedia(hex: string) {
      try {
        // 1. Query backend aggregator endpoint (/api/flights/:icao24/photo)
        const res = await fetch(`${API_BASE}/flights/${encodeURIComponent(hex)}/photo`);
        if (res.ok) {
          const data = (await res.json()) as AircraftPhotoMetadata;
          if (!cancelled) {
            setPhotoMeta(data);
            setIsLoadingPhoto(false);
          }
          return;
        }
      } catch {
        // Fallback to direct Planespotters public endpoint if backend route unreachable
      }

      try {
        const directRes = await fetch(
          `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`
        );
        if (directRes.ok) {
          const json = (await directRes.json()) as {
            photos?: Array<{
              thumbnail_large?: { src?: string };
              thumbnail?: { src?: string };
              src?: string;
              photographer?: string;
              link?: string;
            }>;
          };
          const p = json.photos?.[0];
          if (!cancelled) {
            setPhotoMeta({
              icao24: hex,
              photoUrl: p?.thumbnail_large?.src || p?.thumbnail?.src || p?.src || null,
              photographer: p?.photographer || null,
              photoLink: p?.link || null,
              aircraftModel:
                ac?.aircraft_model ||
                (ac?.isHelicopter ? 'Helicóptero ADS-B' : 'Aeronave Comercial ADS-B'),
              aircraftCode: ac?.aircraft_code || (ac?.isHelicopter ? 'HELI' : 'ADSB'),
              registration: ac?.registration || hex.toUpperCase(),
              operator: null,
              category: ac?.isHelicopter ? 'helicopter' : 'twin-jet',
            });
          }
        }
      } catch {
        // Ignore network error; vector silhouette placeholder will be displayed
      } finally {
        if (!cancelled) {
          setIsLoadingPhoto(false);
        }
      }
    }

    void loadAircraftMedia(selectedHex);

    return () => {
      cancelled = true;
    };
  }, [selectedHex]);

  if (!ac) {
    return null;
  }

  const baroFeet = metersToFeet(ac.renderAlt);
  const geoFeet = metersToFeet(ac.geo_altitude || ac.renderAlt + 120);
  const flightLevel = `FL${Math.max(0, Math.round(baroFeet / 100))
    .toString()
    .padStart(3, '0')}`;
  const knots = msToKnots(ac.velocity);
  const kmh = msToKmh(ac.velocity);
  const mach = msToMach(ac.velocity, ac.renderAlt);
  const vRateFpm = msToFeetPerMin(ac.vertical_rate);
  const squawkInfo = getSquawkAlertInfo(ac.squawk);

  const displayModel =
    photoMeta?.aircraftModel ||
    ac.aircraft_model ||
    (ac.isHelicopter ? 'Helicóptero ADS-B' : 'Aeronave Comercial ADS-B');
  const displayCode =
    photoMeta?.aircraftCode || ac.aircraft_code || (ac.isHelicopter ? 'HELI' : 'ADSB');
  const displayReg =
    photoMeta?.registration || ac.registration || ac.icao24.toUpperCase();
  const displayCategory: AirframeCategory = ac.isHelicopter
    ? 'helicopter'
    : photoMeta?.category || 'twin-jet';

  // Build SVG path for historical altitude profile
  const profilePoints = [...trail.map((t) => t.alt), ac.renderAlt];
  const maxAlt = Math.max(12500, ...profilePoints);
  const svgPolyline =
    profilePoints.length > 1
      ? profilePoints
          .map((alt, idx) => {
            const x = (idx / (profilePoints.length - 1)) * 280;
            const y = 62 - (Math.max(0, alt) / maxAlt) * 52;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '0,45 280,45';

  return (
    <aside className="fixed top-20 right-4 z-20 w-[385px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl bg-slate-950/82 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_45px_rgba(6,182,212,0.18)] text-slate-100 p-4 transition-all duration-200">
      {/* Pulsing Emergency Squawk Banner (7500 / 7600 / 7700) */}
      {squawkInfo.isEmergency && (
        <div
          className={`mb-3 p-3 rounded-xl border flex items-center gap-3 animate-pulse ${
            squawkInfo.severity === 'critical'
              ? 'bg-red-950/85 border-red-500 text-red-100 shadow-[0_0_25px_rgba(239,68,68,0.55)]'
              : 'bg-amber-950/85 border-amber-500 text-amber-100 shadow-[0_0_25px_rgba(245,158,11,0.45)]'
          }`}
        >
          <ShieldAlert className="w-6 h-6 text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider font-bold">
              ALERTA TRANSPONDEDOR · SQUAWK {squawkInfo.code}
            </div>
            <div className="text-xs font-semibold truncate">{squawkInfo.label}</div>
          </div>
        </div>
      )}

      {/* 16:9 Aircraft Photograph Header / Skeleton Loader / Vector Category Silhouette */}
      <div className="mb-3">
        {isLoadingPhoto ? (
          <div className="w-full aspect-video rounded-xl bg-slate-900/90 border border-slate-800 animate-pulse flex flex-col items-center justify-center gap-2 relative overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
              <Camera className="w-4 h-4 text-cyan-400 animate-bounce" />
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              CONSULTANDO PLANESPOTTERS ({ac.icao24.toUpperCase()})...
            </span>
          </div>
        ) : photoMeta?.photoUrl && !imgError ? (
          <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-cyan-500/35 bg-slate-900 shadow-lg group">
            <img
              src={photoMeta.photoUrl}
              alt={`${ac.callsign} - ${displayModel}`}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
            />
            {/* Top badges on photo */}
            <div className="absolute top-2 left-2 flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md border border-cyan-500/40 text-[10px] font-mono font-bold text-cyan-300">
                MATRÍCULA: {displayReg}
              </span>
              {displayCode && (
                <span className="px-1.5 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md border border-slate-700 text-[10px] font-mono font-semibold text-amber-300">
                  {displayCode}
                </span>
              )}
            </div>

            {/* Bottom Photographer Legal Attribution Bar */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent px-2.5 py-1.5 flex items-center justify-between text-[10px] font-mono text-slate-300">
              <span className="flex items-center gap-1 truncate">
                <Camera className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate">
                  © {photoMeta.photographer || 'Planespotters.net'}
                </span>
              </span>
              {photoMeta.photoLink && (
                <a
                  href={photoMeta.photoLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-0.5 text-cyan-300 hover:text-cyan-200 underline shrink-0 ml-2"
                >
                  <span>Planespotters</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          </div>
        ) : (
          <AirframeCategorySilhouette
            category={displayCategory}
            code={displayCode}
            model={displayModel}
          />
        )}
      </div>

      {/* Header: Callsign, Prominent Aircraft Model, Registration & FIR Badge */}
      <div className="flex items-start justify-between border-b border-slate-800/80 pb-3">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-2xl font-mono font-bold tracking-tight text-cyan-300">
              {ac.callsign}
            </span>
            <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              {ac.fir}
            </span>
            {ac.isHelicopter && (
              <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                HELICÓPTERO
              </span>
            )}
            <span className="px-2 py-0.5 text-[11px] font-mono rounded-md bg-slate-800/90 text-amber-300 border border-amber-500/30">
              {flightLevel}
            </span>
          </div>

          {/* Prominent Aircraft Exact Model Badge */}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-mono font-semibold text-white bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
            <Plane className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">{displayModel}</span>
          </div>

          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400 font-mono flex-wrap">
            <span className="text-slate-300 font-semibold">REG: {displayReg}</span>
            <span>•</span>
            <span>HEX: {ac.icao24.toUpperCase()}</span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-300">
              <Globe2 className="w-3 h-3 text-cyan-400" />
              {photoMeta?.operator || ac.origin_country}
            </span>
          </div>
        </div>

        <button
          onClick={() => setSelectedIcao24(null)}
          className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors shrink-0"
          title="Cerrar HUD Táctico"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Camera Lock & Center Controls */}
      <div className="mt-3 flex items-center justify-between gap-2 bg-slate-900/70 px-3 py-2 rounded-xl border border-slate-800/80">
        <button
          onClick={() =>
            flyTo({
              lat: ac.renderLat,
              lon: ac.renderLon,
              zoom: 8.2,
              pitch: 35,
            })
          }
          className="flex items-center gap-1.5 text-xs font-mono text-cyan-300 hover:text-cyan-200 transition-colors"
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>CENTRAR EN TRAZA</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">SEGUIMIENTO</span>
          <Switch.Root
            checked={followSelected}
            onCheckedChange={setFollowSelected}
            className="w-9 h-5 bg-slate-800 rounded-full relative data-[state=checked]:bg-cyan-500 transition-colors outline-none cursor-pointer"
          >
            <Switch.Thumb className="block w-3.5 h-3.5 bg-white rounded-full transition-transform duration-150 translate-x-1 data-[state=checked]:translate-x-4" />
          </Switch.Root>
        </div>
      </div>

      {/* Primary Telemetry Grid: Altitudes & Speeds */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {/* Barometric Altitude */}
        <div className="p-3 rounded-xl bg-slate-900/65 border border-slate-800/90">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>ALT. BAROMÉTRICA</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="mt-1 text-lg font-mono font-bold text-white">
            {baroFeet.toLocaleString()} <span className="text-xs font-normal text-cyan-400">ft</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            {Math.round(ac.renderAlt).toLocaleString()} m MSL · {flightLevel}
          </div>
        </div>

        {/* Geometric Altitude */}
        <div className="p-3 rounded-xl bg-slate-900/65 border border-slate-800/90">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>ALT. GEOMÉTRICA</span>
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="mt-1 text-lg font-mono font-bold text-white">
            {geoFeet.toLocaleString()}{' '}
            <span className="text-xs font-normal text-indigo-400">ft</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            {Math.round(ac.geo_altitude || ac.renderAlt + 120).toLocaleString()} m WGS84
          </div>
        </div>

        {/* Ground Speed & Mach */}
        <div className="p-3 rounded-xl bg-slate-900/65 border border-slate-800/90">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>VELOCIDAD (GS)</span>
            <Gauge className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg font-mono font-bold text-white">
              {knots} <span className="text-xs font-normal text-emerald-400">kts</span>
            </span>
            <span className="text-xs font-mono font-semibold text-amber-300">
              M {mach.toFixed(2)}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            {kmh} km/h · {ac.velocity.toFixed(1)} m/s
          </div>
        </div>

        {/* Vertical Rate (Climb / Descent) */}
        <div className="p-3 rounded-xl bg-slate-900/65 border border-slate-800/90">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>RÉGIMEN VERTICAL</span>
            {vRateFpm > 50 ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            ) : vRateFpm < -50 ? (
              <ArrowDownRight className="w-4 h-4 text-amber-400" />
            ) : (
              <Minus className="w-4 h-4 text-slate-400" />
            )}
          </div>
          <div
            className={`mt-1 text-lg font-mono font-bold ${
              vRateFpm > 50
                ? 'text-emerald-300'
                : vRateFpm < -50
                ? 'text-amber-300'
                : 'text-white'
            }`}
          >
            {vRateFpm > 0 ? `+${vRateFpm}` : vRateFpm}{' '}
            <span className="text-xs font-normal text-slate-400">ft/min</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            {ac.vertical_rate >= 0 ? `+${ac.vertical_rate.toFixed(1)}` : ac.vertical_rate.toFixed(1)}{' '}
            m/s · {ac.on_ground ? 'EN TIERRA' : 'EN VUELO'}
          </div>
        </div>
      </div>

      {/* True Track Compass & Squawk Transponder Module */}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <div className="p-3 rounded-xl bg-slate-900/65 border border-slate-800/90 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>RUMBO (TRACK)</span>
            </div>
            <div className="mt-1 text-lg font-mono font-bold text-white">
              {Math.round(ac.renderTrack).toString().padStart(3, '0')}°
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              PIVOTE CENTRAL ACTIVO
            </div>
          </div>

          <div className="w-11 h-11 rounded-full border border-cyan-500/40 bg-slate-950 flex items-center justify-center relative">
            <span className="absolute -top-1 text-[8px] font-mono text-cyan-400">N</span>
            <Navigation
              className="w-5 h-5 text-cyan-400 transition-transform duration-150"
              style={{ transform: `rotate(${ac.renderTrack - 45}deg)` }}
            />
          </div>
        </div>

        {/* Squawk Transponder Status */}
        <div
          className={`p-3 rounded-xl border ${
            squawkInfo.isEmergency
              ? 'bg-red-950/60 border-red-500/80 animate-pulse'
              : 'bg-slate-900/65 border-slate-800/90'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>SQUAWK (SSR)</span>
            <Radio
              className={`w-3.5 h-3.5 ${
                squawkInfo.isEmergency ? 'text-red-400' : 'text-cyan-400'
              }`}
            />
          </div>
          <div
            className={`mt-1 text-xl font-mono font-bold tracking-widest ${
              squawkInfo.isEmergency ? 'text-red-300' : 'text-cyan-300'
            }`}
          >
            {squawkInfo.code}
          </div>
          <div className="text-[10px] font-mono truncate text-slate-300">
            {squawkInfo.label}
          </div>
        </div>
      </div>

      {/* Geodesic Coordinates & Spatial Hash Metadata */}
      <div className="mt-2.5 p-3 rounded-xl bg-slate-900/65 border border-slate-800/90 font-mono text-xs space-y-1.5">
        <div className="flex justify-between">
          <span className="text-slate-400">COORDENADAS (P_t):</span>
          <span className="text-cyan-200">
            {ac.renderLat.toFixed(4)}°, {ac.renderLon.toFixed(4)}°
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">GEOHASH ESPACIAL:</span>
          <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            #{ac.geohash}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">ORIGEN / RUTA:</span>
          <span className="text-emerald-300 truncate max-w-[180px]">{ac.origin_country}</span>
        </div>
      </div>

      {/* Historical Geodesic Breadcrumbs Altitude Profile */}
      <div className="mt-3 p-3 rounded-xl bg-slate-900/75 border border-slate-800/90">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2">
          <span>PERFIL DE ALTITUD (BREADCRUMBS GEODÉSICOS)</span>
          <span className="text-cyan-300">{profilePoints.length} pts</span>
        </div>
        <svg viewBox="0 0 280 68" className="w-full h-16 overflow-visible">
          <defs>
            <linearGradient id="altGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <line x1="0" y1="62" x2="280" y2="62" stroke="#1e293b" strokeWidth="1" />
          <line x1="0" y1="32" x2="280" y2="32" stroke="#1e293b" strokeDasharray="3 3" strokeWidth="1" />
          <polyline
            fill="none"
            stroke="url(#altGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={svgPolyline}
          />
        </svg>
      </div>

      {/* Tactical Emergency Squawk Simulator Controls */}
      <div className="mt-3 pt-3 border-t border-slate-800/80">
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span>SIMULADOR TÁCTICO DE EMERGENCIA SQUAWK:</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 font-mono text-xs">
          <button
            onClick={() => onSimulateSquawk('7700', ac.icao24)}
            className="py-1.5 px-2 rounded-lg bg-red-950/70 hover:bg-red-900/90 border border-red-500/50 text-red-200 font-semibold transition-colors"
            title="7700: Emergencia General"
          >
            7700
          </button>
          <button
            onClick={() => onSimulateSquawk('7600', ac.icao24)}
            className="py-1.5 px-2 rounded-lg bg-amber-950/70 hover:bg-amber-900/90 border border-amber-500/50 text-amber-200 font-semibold transition-colors"
            title="7600: Falla de Radio"
          >
            7600
          </button>
          <button
            onClick={() => onSimulateSquawk('7500', ac.icao24)}
            className="py-1.5 px-2 rounded-lg bg-rose-950/70 hover:bg-rose-900/90 border border-rose-500/50 text-rose-200 font-semibold transition-colors"
            title="7500: Interferencia Ilícita"
          >
            7500
          </button>
          <button
            onClick={() => onSimulateSquawk('1200', ac.icao24)}
            className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors"
            title="Restaurar Squawk Normal"
          >
            NORM
          </button>
        </div>
      </div>
    </aside>
  );
};
