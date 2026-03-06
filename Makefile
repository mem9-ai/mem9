.PHONY: build vet clean run test test-integration docker

build:
	cd server && go build -o mnemo-server ./cmd/mnemo-server

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

docker:
	docker build -t mnemo-server ./server

