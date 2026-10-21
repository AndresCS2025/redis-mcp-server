# Stage 1: Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests and install all dependencies (including devDependencies for TypeScript compilation)
COPY package.json package-lock.json* ./
RUN npm ci --no-audit

# Copy source code and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune devDependencies to keep runtime clean
RUN npm prune --production

# Stage 2: Minimal Runtime Stage
FROM node:22-alpine AS runtime

WORKDIR /app

# Set non-root environment and production flags
ENV NODE_ENV=production
ENV MCP_PORT=3000
ENV MCP_HOST=0.0.0.0

# Copy runtime node_modules and compiled output
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

# Switch to standard non-root user
USER node

# Expose HTTP port
EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the MCP server
CMD ["node", "dist/index.js"]
