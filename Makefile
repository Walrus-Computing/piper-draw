.PHONY: test test-python test-gui dev build lint

test: test-python test-gui  ## Run all tests

test-python:  ## Run Python tests
	uv run pytest

test-gui:  ## Run GUI (Vitest) tests
	cd gui && npm test

dev:  ## Start dev servers (frontend + backend)
	cd gui && npm run dev

build:  ## Build the GUI for production
	cd gui && npm run build

lint:  ## Lint Python and GUI code
	cd gui && npm run lint
