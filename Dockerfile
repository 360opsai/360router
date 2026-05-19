FROM node:20-slim AS base
LABEL org.opencontainers.image.source="https://github.com/360opsai/360ops-portal"
LABEL org.opencontainers.image.description="360Router — Smart AI proxy. Local first, cloud when needed."
LABEL org.opencontainers.image.vendor="360opsAI LLC"

WORKDIR /app

# Install 360router from npm (always latest)
RUN npm install -g 360router@latest

# Config volume — mount your ~/.360router here
VOLUME ["/config"]
ENV XDG_CONFIG_HOME=/config

# Default port
EXPOSE 3600

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD curl -sf http://localhost:3600/health || exit 1

# Run the proxy server
ENTRYPOINT ["360router"]
CMD ["serve"]
