MAKEFILE_DIR:=$(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
IMG ?= $(REGISTRY)/mnemo-server:$(COMMIT)

.PHONY: build vet clean run test test-integration docker benchmark

build:
	mkdir -p $(MAKEFILE_DIR)/./bin
	cd server && CGO_ENABLED=0 go build -o ./bin/mnemo-server ./cmd/mnemo-server


build-linux:
	mkdir -p $(MAKEFILE_DIR)/./bin
	cd server && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ./bin/mnemo-server ./cmd/mnemo-server

vet:
	cd server && go vet ./...

test:
	cd server && go test -race -count=1 ./...

test-integration:
	cd server && go test -tags=integration -race -count=1 -v ./internal/repository/tidb/
clean:
	rm -f server/mnemo-server

run: build
	cd server && MNEMO_DSN="$(MNEMO_DSN)" ./mnemo-server

docker: build-linux
	docker build --platform=linux/amd64 -q -f ./server/Dockerfile -t $(IMG) .

benchmark:
	@scripts/benchmark.sh
