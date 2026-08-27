.DEFAULT_GOAL := all
.PHONY: all help check check-python check-frontend \
        lint lint-python lint-frontend \
        format format-check format-python-check format-python format-frontend \
        typecheck typecheck-python typecheck-frontend \
        test test-python test-frontend test-coverage \
        validate-workouts simulate simulate-scenarios simulate-diff \
        simulate-calibrate simulate-fatigue-fusion simulate-subjective-drift \
        compare-sequence-search build build-frontend \
        deploy deploy-hosting deploy-all deploy-rules deploy-indexes \
        install clean

# -----------------------------------------------------------------------------
# Main Verification Targets
# -----------------------------------------------------------------------------

## Run all code checks, test suites, simulations, and production build
all: check simulate build
	@echo ================================================================================
	@echo [OK] All checks, tests, simulations, and build passed successfully!
	@echo ================================================================================

## Run full test suites for both backend and frontend
test: test-python test-frontend

## Run full typecheck for both backend and frontend
typecheck: typecheck-python typecheck-frontend

## Run all linters for both backend and frontend
lint: lint-python lint-frontend

## Check formatting without making modifications
format-check: format-python-check

## Automatically fix formatting and auto-fixable lint issues across the repository
format: format-python format-frontend

## Run validation checks (lint, format-check, typecheck, tests, workout validation)
check: check-python check-frontend

## Run all backend Python checks and tests
check-python: lint-python format-python-check typecheck-python test-python

## Run all frontend TypeScript checks and tests
check-frontend: typecheck-frontend lint-frontend test-frontend validate-workouts

## Run simulation scenario benchmarks and baseline diff verification
simulate: simulate-scenarios simulate-diff

## Build production frontend artifact
build: build-frontend

# -----------------------------------------------------------------------------
# Deployment Targets (Production Firebase)
# -----------------------------------------------------------------------------

## Deploy frontend application to Firebase Hosting (builds first)
deploy:
	npm --prefix app run deploy:hosting

## Build and deploy frontend application to Firebase Hosting
deploy-hosting:
	npm --prefix app run deploy:hosting

## Deploy all Firebase assets (Hosting, Firestore rules and indexes)
deploy-all:
	npm --prefix app run deploy:all

## Deploy Firestore security rules with drift check and emulator validation
deploy-rules:
	npm --prefix app run firestore:rules:deploy -- --confirm

## Deploy Firestore indexes
deploy-indexes:
	npm --prefix app run deploy:indexes

# -----------------------------------------------------------------------------
# Python Backend Targets
# -----------------------------------------------------------------------------

## Lint Python backend source and tests with ruff (including code formatting)
lint-python:
	uv run ruff check .
	uv run ruff format --check .

## Check Python code formatting with ruff
format-python-check:
	uv run ruff format --check .

## Auto-format Python code and fix autofixable lint issues
format-python:
	uv run ruff format .
	uv run ruff check --fix .

## Run static type checking with mypy on backend source
typecheck-python:
	uv run mypy src/garmin_sync

## Run backend unit tests with pytest
test-python:
	uv run pytest

## Run backend unit tests with coverage report
test-coverage:
	uv run pytest --cov=garmin_sync --cov-report=term-missing --cov-report=xml:artifacts/coverage/python/coverage.xml

# -----------------------------------------------------------------------------
# TypeScript Frontend Targets
# -----------------------------------------------------------------------------

## Typecheck frontend application with tsc
typecheck-frontend:
	npm --prefix app run typecheck

## Lint frontend code with eslint
lint-frontend:
	npm --prefix app run lint

## Auto-fix frontend lint issues
format-frontend:
	npm --prefix app run lint:fix

## Run frontend unit and scenario test suite with vitest
test-frontend:
	npm --prefix app run test

## Validate workout catalog definitions and prescription contracts
validate-workouts:
	npm --prefix app run validate:workouts

## Run multi-week engine simulations and produce report
simulate-scenarios:
	npm --prefix app run simulate:scenarios

## Verify simulation semantic diff against committed baseline
simulate-diff:
	npm --prefix app run simulate:diff

## Run synthetic scenario calibration suite
simulate-calibrate:
	npm --prefix app run simulate:calibrate

## Run fatigue fusion comparison simulation
simulate-fatigue-fusion:
	npm --prefix app run simulate:fatigue-fusion

## Run subjective drift evidence and sensitivity comparison simulation
simulate-subjective-drift:
	npm --prefix app run simulate:subjective-drift

## Run sequence search comparison (beam search vs greedy)
compare-sequence-search:
	npm --prefix app run compare:sequence-search

## Build frontend production bundle
build-frontend:
	npm --prefix app run build

# -----------------------------------------------------------------------------
# Setup and Utility Targets
# -----------------------------------------------------------------------------

## Restore and sync all dependencies for Python backend and Node frontend
install:
	uv sync
	npm --prefix app ci

## Clean temporary build, test, and cache artifacts
clean:
	-rmdir /s /q .pytest_cache 2>nul || rm -rf .pytest_cache 2>/dev/null || true
	-rmdir /s /q .ruff_cache 2>nul || rm -rf .ruff_cache 2>/dev/null || true
	-rmdir /s /q .mypy_cache 2>nul || rm -rf .mypy_cache 2>/dev/null || true
	-rmdir /s /q app\dist 2>nul || rm -rf app/dist 2>/dev/null || true

## Display list of available targets
help:
	@echo Adaptive Training Recommender - Makefile Commands
	@echo --------------------------------------------------------------------------------
	@echo Main Targets:
	@echo   make all               - Run all code checks, tests, simulations, and build
	@echo   make check             - Run all Python and Frontend checks and tests
	@echo   make test              - Run backend and frontend test suites
	@echo   make lint              - Run backend and frontend linters
	@echo   make typecheck         - Run backend and frontend type checks
	@echo   make format            - Auto-format code across Python and Frontend
	@echo   make simulate          - Run engine simulations and check baseline diff
	@echo   make build             - Build frontend production bundle
	@echo   make deploy            - Build and deploy frontend app to Firebase Hosting
	@echo   make deploy-all        - Build and deploy all Firebase assets (Hosting + Rules + Indexes)
	@echo   make deploy-rules      - Deploy Firestore security rules (with drift check)
	@echo   make deploy-indexes    - Deploy Firestore indexes
	@echo   make install           - Install all dependencies (uv sync + npm ci)
	@echo --------------------------------------------------------------------------------
	@echo Python Targets:
	@echo   make check-python      - Run ruff, format-check, mypy, and pytest
	@echo   make lint-python       - Run ruff linter
	@echo   make format-python     - Format Python code with ruff
	@echo   make typecheck-python  - Run mypy type checker
	@echo   make test-python       - Run pytest test suite
	@echo   make test-coverage     - Run pytest with coverage report
	@echo --------------------------------------------------------------------------------
	@echo Frontend Targets:
	@echo   make check-frontend    - Run tsc, eslint, vitest, and workout validation
	@echo   make typecheck-frontend- Run TypeScript compiler check
	@echo   make lint-frontend     - Run ESLint
	@echo   make test-frontend     - Run Vitest suite
	@echo   make validate-workouts - Validate workout catalog and contracts
	@echo   make simulate-scenarios- Run scenario simulations
	@echo   make simulate-diff     - Compare scenario simulation against baseline
	@echo   make build-frontend    - Build production Vite bundle
