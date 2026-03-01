.PHONY: build vet clean run

build:
	cd server && go build -o mnemo-server ./cmd/mnemo-server

vet:
	cd server && go vet ./...

clean:
	rm -f server/mnemo-server

run: build
	cd server && MNEMO_DSN="$(MNEMO_DSN)" ./mnemo-server

docker:
	docker build -t mnemo-server ./server
