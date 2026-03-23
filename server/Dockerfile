# --- Build stage: always runs on host arch for speed ---
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /mnemo-server ./cmd/mnemo-server

# --- Runtime stage: target arch ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /mnemo-server /mnemo-server
EXPOSE 8080
ENTRYPOINT ["/mnemo-server"]
