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
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
RUN npm run build

FROM nginx:1.29-alpine AS final
# The CSP names the API and Auth0 origins, so it is generated from the same
# build args Vite inlines — the policy cannot drift from the real origins.
ARG VITE_API_BASE
ARG VITE_AUTH0_DOMAIN
COPY nginx.conf.template /etc/nginx/conf.d/default.conf
COPY security-headers.inc.template /tmp/security-headers.inc.template
RUN set -eu; \
    api="${VITE_API_BASE%/}"; \
    CSP_CONNECT="$api"; CSP_FRAME="'none'"; \
    if [ -n "${VITE_AUTH0_DOMAIN:-}" ]; then \
      CSP_CONNECT="$CSP_CONNECT https://${VITE_AUTH0_DOMAIN}"; \
      CSP_FRAME="https://${VITE_AUTH0_DOMAIN}"; \
    fi; \
    export CSP_CONNECT CSP_FRAME; \
    envsubst '${CSP_CONNECT} ${CSP_FRAME}' < /tmp/security-headers.inc.template \
      > /etc/nginx/conf.d/security-headers.inc; \
    rm /tmp/security-headers.inc.template
COPY --from=build /src/dist/ /usr/share/nginx/html/

EXPOSE 8080
