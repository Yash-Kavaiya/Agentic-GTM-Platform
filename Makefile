# Bellwether
#
# The engine runs here and in CI; the web app is a static read of what it wrote.
# Every target below works from a clean clone with only Node 22+ installed.

SHELL := /bin/sh
DEMO_DB := data/demo.db

.PHONY: help install probe provision run brief enrich export demo bench dev build test check clean

help:
	@echo "Bellwether"
	@echo ""
	@echo "  make install    install dependencies"
	@echo "  make demo       seed the scripted scenario and serve the app  <- start here"
	@echo "  make check      typecheck + full test suite"
	@echo ""
	@echo "  make probe      verify which public pages each target actually serves"
	@echo "  make provision  create Bright Data collectors (needs BRIGHTDATA_API_KEY)"
	@echo "  make run        collect, diff, and fire signals against live sources"
	@echo "  make enrich     read brand kits off each target's homepage"
	@echo "  make brief      render today's Morning Brief in the terminal"
	@echo "  make bench      inject drift and measure the heal loop"
	@echo ""

install:
	npm install

# ----------------------------------------------------------------- engine

probe:
	npm run probe

provision:
	npm run bw:provision

run:
	npm run bw -- run

brief:
	npm run bw -- brief

enrich:
	npm run bw -- enrich

export:
	npm run bw -- export

# ------------------------------------------------------------------- demo

# Rebuilds the scripted scenario from scratch and serves it.
# Writes to a separate database so seeded data can never be mistaken for
# observed data. See cli/seed.ts for exactly what is authored and what is not.
demo:
	@rm -f $(DEMO_DB) $(DEMO_DB)-wal $(DEMO_DB)-shm
	npm run seed
	npm run bw -- export --db $(DEMO_DB) --date 2026-08-21
	@echo ""
	@echo "Demo data ready. Starting the app on http://localhost:3000"
	@echo ""
	npm run dev

bench:
	npm run bench

# --------------------------------------------------------------------- app

dev:
	npm run dev

build:
	npm run build

# ------------------------------------------------------------------ checks

test:
	npm test

check:
	npm run typecheck
	npm test

clean:
	rm -rf .next data/bellwether.db* $(DEMO_DB)*
