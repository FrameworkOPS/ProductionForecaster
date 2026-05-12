# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY skyright-forecaster/frontend/package*.json ./
RUN npm install
COPY skyright-forecaster/frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY skyright-forecaster/skyright-forecaster/package*.json ./
RUN npm install --include=dev
COPY skyright-forecaster/skyright-forecaster/ ./
RUN npm run build

# Stage 3: Production runtime
FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --break-system-packages pymupdf 2>/dev/null || \
    pip3 install pymupdf
WORKDIR /app
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./package.json
# Python script for PDF→image conversion (pdfParserService resolves to /app/scripts/)
COPY --from=backend-builder /app/src/scripts ./scripts
RUN mkdir -p /app/uploads
# Backend: path.join(__dirname='/app/dist', '../../frontend/dist') => /frontend/dist
COPY --from=frontend-builder /build/dist /frontend/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
