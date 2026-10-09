# ilLumenate Lighting Riser Generator 1.3.0 (ERP edition)

> **Deprecated.** This is the last standalone release. New designs belong in the **ilLumenate System Designer**, which opens fixture schedules from the ilLumenate portal and carries this generator's riser engine. This repository will be archived when the System Designer reaches general availability.

Local lighting-system workspace: enter system tables, review electrical calculations, arrange riser sheets, and export vector PDF, native DXF, SVG and schedules. React, strict TypeScript and Vite; projects and libraries stay in browser IndexedDB. The optional local proxy loads the ilLumenate catalog and only reads from ERPNext.

## Start

Requires Node.js 22.13+ and npm. Dependencies are already installed in Kevin's working folder. For an extracted source package:

```sh
npm ci
npm run dev
```

Open [the local workspace](http://127.0.0.1:5173/#/project). Windows users can start it with `Start Riser.cmd` after installing dependencies. Keep its terminal open. Use the same browser and origin; `localhost` and `127.0.0.1` have separate storage.

For the demo, create a new project, then choose **Tables → Load complete example → Review → Drawing → Export**. Loading the example replaces the active design tables.

Defaults: ARCH D 36 × 24 inches, `L-#` numbering, 80% PSU target, 2023 reference tables. Seed products and wires are **EXAMPLE** data. The supplied price workbook was inspected without modification; it lacks the electrical ratings required for an engineering catalog. The supplied ilLumenate Lighting vector logo appears in monochrome on title blocks; workspace colors follow the brand palette. See `docs/branding.md` for artwork provenance and typography.

## Documentation

- [Drawing revision 1.1](docs/drawing-revision-1.1.md): clean equipment blocks, separated cable lanes and explicit crossings.
- [User guide](docs/user-guide.md): entry, imports, calculations, drawings, backups and the ilLumenate catalog.
- [CAD import test](docs/cad-import-test.md): AutoCAD results and PDFIMPORT behavior.
- [Acceptance report](docs/acceptance-report.md): implementation, evidence and external inputs.
- [Schema/data provenance](docs/schema-and-seed-decisions.md) and [dependency verification](docs/dependency-verification.md).

The original plan and Phase 0/1 checkpoints remain as historical records. Kevin's later instruction superseded their phase-review stops. The maintained Cantoo PDF fork was expressly accepted. Version 1.3.0 replaced the temporary ERP demo and field mapping with the ilLumenate catalog.

## Validate and build

```sh
npm run ci
```

Runs formatting, lint, unit/integration coverage, TypeScript, production build and Playwright. Browser tests use installed Microsoft Edge; another machine may need `npx playwright install msedge`. Proxy tests use a local test server and mocked upstream responses; catalog tests use the TEST records from the ERP repository.

`npm run test:e2e` tests the production preview; run `npm run build` first when invoking it separately.

```sh
npm run build
npm run preview
```

The production preview is at `http://127.0.0.1:4173`. Its storage origin differs from development; transfer a project and library backup when needed. Serve `dist/` over HTTP instead of opening its HTML as a local file.

## Architecture

- `src/schemas`: Zod source of truth and project migrations; legacy originals are preserved.
- `src/engine`: pure graph, loading, CV/CC checks, voltage drop, wire selection, DMX and BOM calculations.
- `src/drawing`: shared paper-inch primitives, 23 plain equipment symbols, aligned column layout, pin rerouting, pagination and schedules; the browser uses a worker.
- `src/serializers`: SVG, embedded TrueType PDF with optional-content layers, and native R2007 DXF blocks/attributes.
- `src/features`: project, four grids, library imports, review, drawing, exports and the ilLumenate catalog.
- `server/proxy.mjs`: optional loopback-only Express transport; credentials stay in local `.env`.

Heavy grids, layout and PDF modules load on demand. Development prebundles lazy export dependencies to prevent a first-download reload. Large dependency chunks produce a non-blocking build advisory.

## ERP edition: the ilLumenate catalog

**Libraries → ilLumenate catalog → Load ilLumenate catalog** reads the product catalog ilLumenate publishes for the System Designer (`get_catalog_for_desktop`). It needs an API key for an ilLumenate staff user with engineering access:

1. Copy `.env.example` to `.env` and set `ERPNEXT_BASE_URL`, `ERPNEXT_API_KEY` and `ERPNEXT_API_SECRET`.
2. Run `npm run proxy` (loopback port 8787) next to `npm run dev`.
3. Load the catalog, review the counts, then **Apply catalog**. Undo restores the previous library.

Catalog products are read-only: edit, CSV import and grid edits refuse them, and they carry no local overrides. Duplicate one to make a local variant. A supply's catalog usable-load factor tightens the project operating target. Catalog products that leave the catalog stay in the library, read-only, so existing projects still open. The proxy only reads; credentials stay in the local `.env`.

No hosted deployment, cloud storage or telemetry is included.
