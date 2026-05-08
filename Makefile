.PHONY: install test test-python test-gui dev build lint

install:  ## Install all dependencies
	uv sync
	cd gui && npm install

test: install test-python test-gui  ## Run all tests

test-python: install  ## Run Python tests
	uv run pytest

test-gui: install  ## Run GUI (Vitest) tests
	cd gui && npm test

dev: install  ## Start dev servers (frontend + backend)
	cd gui && npm run dev && open

URL := http://localhost:5173

open: install dev
	@which xdg-open > /dev/null && xdg-open $(URL) || which open > /dev/null && open $(URL) || start $(URL) 

build: install  ## Build the GUI for production
	cd gui && npm run build

lint: install  ## Lint Python and GUI code
	cd gui && npm run lint
