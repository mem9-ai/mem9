FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /mnemo-server ./cmd/mnemo-server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /mnemo-server /mnemo-server
EXPOSE 8080
ENTRYPOINT ["/mnemo-server"]
