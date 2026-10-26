.PHONY: build backend frontend test fmt

# The backend for EC2 (Graviton) and the frontend bundle for S3.
build: backend frontend

backend:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o dist/oscillofloat ./cmd/oscillofloat

frontend:
	cd frontend && npm install && npm run build

test:
	go vet ./...
	go test ./...
	cd frontend && npm run typecheck && npm run format:check && npm test

fmt:
	gofmt -w cmd internal
	cd frontend && npm run format
