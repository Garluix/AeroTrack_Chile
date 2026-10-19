FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_WS_URL=ws://localhost:4000/ws
ARG VITE_API_URL=http://localhost:4000/api
ARG VITE_INITIAL_LAT=-33.4489
ARG VITE_INITIAL_LON=-70.6693
ARG VITE_INITIAL_ZOOM=6.0
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_INITIAL_LAT=$VITE_INITIAL_LAT
ENV VITE_INITIAL_LON=$VITE_INITIAL_LON
ENV VITE_INITIAL_ZOOM=$VITE_INITIAL_ZOOM
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
