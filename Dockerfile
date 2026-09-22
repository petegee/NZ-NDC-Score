# Multi-stage build for the NdcScore SPA — a pure static client of the
# Soarscore API, so the final image is just nginx serving the built assets.
# VITE_API_BASE is baked in at build time (Vite inlines it); fly.toml supplies
# it as a build arg.

FROM node:22-alpine AS build
WORKDIR /src

# Copy package files first for better layer caching on install
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_API_BASE
RUN npm run build

FROM nginx:1.29-alpine AS final
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/

EXPOSE 8080
