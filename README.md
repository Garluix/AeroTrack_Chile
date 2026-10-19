# AeroTrack Chile — Monitorización Cartográfica ADS-B de Alta Concurrencia

Plataforma web integral, reactiva y contenerizada para la monitorización táctica de tráfico aéreo en tiempo real sobre el espacio aéreo de Chile (**FIRs DGAC: SCEZ, SCFA, SCTE, SCCF y SCIP**) con transición continua hacia visualización global (*slippy map*).

---

## 1. Arquitectura de Sistemas y Pila Tecnológica

### Backend (`backend/` — API Gateway & Telemetry Broker)
- **Entorno:** Node.js + TypeScript (`strict: true`) sobre **Fastify** y `@fastify/websocket` (`ws` nativo).
- **Almacenamiento Volátil y Caché:** **Redis 7** (`ioredis`) con *fallback* en memoria de sub-milisegundo para:
  - Deduplicación de tramas ADS-B mediante firma de estado (`lat:lon:alt:vel:track:squawk`).
  - Persistencia volátil de trazas históricas geodésicas (*flight breadcrumbs*) con expiración TTL automática.
  - Gestión de cuotas de consumo (*rate limiting* y *cooldown* ante `HTTP 429` de OpenSky).
- **Difusión en Tiempo Real con Spatial Hashing:**
  - Codificación **Geohash (nivel 4–6)** para cada aeronave e intersección dinámica con el *viewport* de cada cliente conectado vía evento `viewport_changed`.
  - Consulta acotada por defecto al **Bounding Box de Chile** (`lamin: -56.5, lomin: -109.5, lamax: -17.5, lomax: -66.0`) cubriendo Chile continental, archipiélago de Juan Fernández y Rapa Nui (`SCIP`), expandiéndose dinámicamente bajo demanda cuando los clientes navegan fuera del dominio inicial.

### Frontend (`frontend/` — WebGL 60 FPS & Tactical Glassmorphic HUD)
- **Framework & Estado:** React 18 (Vite) + TypeScript en modo estricto + **Zustand** con selectores granulares y buffer cinemático mutable en sitio para evitar re-renderizados de React durante el bucle a 60 FPS.
- **Renderizado Cartográfico WebGL:** **MapLibre GL JS** (*CartoDB Dark Matter No-Labels* para suprimir etiquetas redundantes) + **Deck.gl v9** (`IconLayer`, `PathLayer`, `PolygonLayer`, `ScatterplotLayer`).
- **Cinemática de Cliente a 60 FPS (`useDeadReckoning.ts` + `utils/kinematics.ts`):**
  - Proyección sobre círculo máximo (**Great Circle Forward Projection**) de la posición estimada $P_t$ a partir de $P_0$, velocidad respecto al suelo (*ground speed*), rumbo verdadero (`true_track`) y $\Delta t$.
  - Corrección de error exponencial ($\alpha = 1 - e^{-\lambda \Delta t}$) mediante **Spherical Linear Interpolation (Slerp)** para prohibir cualquier teletransportación al recibir nuevos paquetes WebSocket.
  - Rotación vectorial exacta sobre el pivote central `(64, 64)` del atlas SVG de la aeronave en sincronía con `true_track`.

---

## 2. Ejecución Rápida

### Opción A: Despliegue Orquestado con Docker Compose
```bash
cp .env.example .env
docker compose up --build -d
```
- **Frontend UI Táctico:** `http://localhost:8080`
- **Backend API & WebSocket Gateway:** `http://localhost:4000/api/health` | `ws://localhost:4000/ws`

### Opción B: Ejecución en Entorno Local (Node.js)
```bash
# Terminal 1 - Backend Gateway
cd backend
npm install
npm run dev

# Terminal 2 - Frontend React + Deck.gl
cd frontend
npm install
npm run dev
```
*(El backend detecta automáticamente si Redis está disponible en `localhost:6379` y activa su almacén volátil en memoria sin fricción si se ejecuta sin contenedor Redis).*
