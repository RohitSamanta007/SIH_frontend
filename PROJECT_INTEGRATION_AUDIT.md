# PROJECT INTEGRATION AUDIT

Audit method: full read of every source file in `frontend/src`, `server/server.js`, `server/config`, `server/src` (routes, controllers, services, models, middleware, utils), `server/tests`, both `.env`/`.env.example`, both `package.json`, `DESIGN.md`, `vite.config.js`, `index.html`. Repo globbed for `*.py` (none found). Nothing was modified.

---

## 1. Executive Summary

- **Backend is far ahead of the frontend.** All 6 core case APIs (create, graph, entity, timeline, guardrail) are fully implemented, enveloped, auth-guarded, and covered by self-contained test scripts (`server/tests/test_t03…t08.js`) that pass against a bundled Mock FastAPI server.
- **Frontend has exactly 2 pages**: `LoginPage.jsx` (fully integrated, verified by you) and `CaseListPage.jsx` (a static placeholder that calls **zero APIs**).
- **Zero frontend callers exist for any `/api/cases*` endpoint.** The entire case domain is backend-complete but frontend-disconnected.
- **One blocking backend gap**: there is **no `GET /api/cases` (list) endpoint**, so the dashboard cannot discover `caseId`s. Every other read API is keyed by `caseId`.
- **FastAPI is not in this repository** (no Python files anywhere). Node→FastAPI client is fully built + tested against a mock; the real service is external ("Argha's"). Case creation hard-fails (502/504) without it — no production fallback.
- **Correct next step**: add `GET /api/cases` (list) on the backend and wire `CaseListPage.jsx` to it with loading/error/empty states. Smallest slice, unblocks everything else, touches no auth code.

---

## 2. Verified Completed Work

| Item | Evidence |
|---|---|
| Backend boot, Mongo connect, seeding | `server/server.js:59-73`, `server/config/db.js`, `authService.seedDefaultInvestigator` |
| Login/JWT/bcrypt/logout/session | You manually verified; code confirmed (`authController.js`, `authService.js`, `authContext.jsx`) |
| Centralized axios client w/ Bearer attach + 401 cleanup | `frontend/src/api/apiClient.js:19-40` |
| Protected routing | `App.jsx:7-24` (`PrivateRoute`) |
| Health endpoint | `health.routes.js` |
| Case intake pipeline (normalize→CSV parse→caseId gen→FastAPI→validate→persist) | `caseIntakeService.js`, `fastApiClient.js`, `caseProcessingService.js`, `resultPersistenceService.js`, `utils/caseIdGenerator.js` |
| Read APIs (graph/entity/timeline/guardrail) incl. cross-case isolation | `caseGraphService.js` + `tests/test_t07.js` (16 assertions) |
| Centralized error envelope `{success, error:{code,message}}` | `errorHandler.js`, `notFoundHandler.js`, `AppError.js` |
| Multer CSV upload (memory, ≤5MB, ≤5 files, MIME/ext filter) | `uploadMiddleware.js` |
| Backend test suites T01–T08 + Mock FastAPI (6 failure modes) | `server/tests/*` |

---

## 3. Current Architecture

```
frontend (Vite+React19+RR7+Tailwind4+axios)          server (Express 5 + Mongoose 9)
├─ main.jsx ─ BrowserRouter > AuthProvider > App      ├─ server.js (cors, json 10mb, routes, error mw)
├─ App.jsx ─ /login, /cases (PrivateRoute), *         ├─ config/{env.js, db.js}  ← .env (Atlas URI)
├─ state/authContext.jsx (login/logout, sessionStorage ├─ routes: health, auth(login,verify), cases(POST,
│   'auth_token'/'auth_user')                          │   :id/graph, :id/entities/:eid, :id/timeline,
├─ api/apiClient.js (baseURL VITE_API_BASE_URL,        │   :id/guardrail/:eid — all authMiddleware;
│   15s timeout, bearer inject, 401 wipe)              │   POST also handleUpload/multer.any())
└─ pages/{LoginPage, CaseListPage=placeholder}         ├─ controllers: authController, caseController
                                                       ├─ services: authService, caseIntakeService,
EXTERNAL FastAPI (NOT in repo, default                 │   caseProcessingService, fastApiClient,
http://127.0.0.1:8000 POST /case) ◄───────────────────┤   resultPersistenceService, caseGraphService
                                                       ├─ middleware: authMiddleware, uploadMiddleware,
MongoDB Atlas "emailscam" ◄────────────────────────────┘   errorHandler, notFoundHandler
                                                       └─ models: User, Case, Entity, Edge, Pattern
                                                          tests: test_t01..t08 style scripts + mockFastApiServer.js
```

---

## 4. Authentication Status

**COMPLETE — do not touch.**
- Flow: `LoginPage` → `authContext.login()` → `POST /auth/login` → bcrypt compare → `jwt.sign({userId, username, role}, secret, 15m)` → `{success,data:{token}}` → `sessionStorage.auth_token/auth_user` → interceptor injects `Authorization: Bearer` → `authMiddleware` verifies → `req.user`.
- Notes (informational, no action now):
  - `JWT_SECRET` falls back to a hardcoded dev default; `JWT_EXPIRES_IN` defaults to `15m` (`config/env.js:13-14`; `server/.env` sets neither).
  - On 401, `apiClient.js:31-40` wipes sessionStorage but **nothing navigates to /login** until the next route render — minor UX gap for later.
  - `GET /api/auth/verify` exists but the frontend never calls it (session restore trusts sessionStorage blindly).

---

## 5. Backend API Inventory

Envelope everywhere: success `{success:true,data,error:null}` / error `{success:false,error:{code,message}}`.

| # | Method | Endpoint | Auth | Request | Response `data` | Impl file | FE caller | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/` | No | – | service info | `server.js:25` | No | N/A (info) |
| 2 | GET | `/health` | No | – | `{status,service,uptime,database}` | `routes/health.routes.js` | No | NOT CONNECTED (optional) |
| 3 | POST | `/api/auth/login` | No | `{username,password}` | `{token}` | `controllers/authController.js:7` | ✅ `state/authContext.jsx:19` | **CONNECTED** |
| 4 | GET | `/api/auth/verify` | Yes | – | `{user}` | `authController.js:50` | No | PARTIALLY CONNECTED (unused by FE) |
| 5 | POST | `/api/cases` | Yes + multer.any() | JSON `{textReports:string\|string[]}` **or** multipart (CSV files any field name, ≤5MB×5, optional `textReports` text field; aliases accepted: `text/report/reports/csvData/csv`) | `{caseId,status,summary:{entitiesCount,edgesCount,patternsCount},createdAt,updatedAt}` (201) | `caseController.js:16` + `caseIntakeService` + `caseProcessingService` + `resultPersistenceService` | **No** | **NOT CONNECTED** |
| 6 | GET | `/api/cases/:caseId/graph` | Yes | – | `{caseId,status,nodes[{canonicalId,type,aliases,attributes,confidence,createdAt}],edges[{id,source,target,edgeType,confidence,timestamp,evidence[],guardrailStatus,guardrailRationale,attributes,createdAt}]}` | `caseGraphService.getCaseGraph` | **No** | **NOT CONNECTED** |
| 7 | GET | `/api/cases/:caseId/entities/:entityId` | Yes | – (`entityId`=canonicalId) | `{caseId,entity{...},relatedEdges[...]}` (404 `ENTITY_NOT_FOUND`) | `caseGraphService.getEntityDetail` | **No** | **NOT CONNECTED** |
| 8 | GET | `/api/cases/:caseId/timeline` | Yes | – | `{caseId,totalEvents,timeline[...]}` asc-by-timestamp, null-timestamp last | `caseGraphService.getCaseTimeline` | **No** | **NOT CONNECTED** |
| 9 | GET | `/api/cases/:caseId/guardrail/:edgeId` | Yes | – (`edgeId`=Edge `_id`) | `{caseId,edgeId,edge{...,evidence[]}}` (404 `EDGE_NOT_FOUND`) | `caseGraphService.getGuardrailDetail` | **No** | **NOT CONNECTED** |
| 10 | — | `GET /api/cases` (list) | — | — | — | **DOES NOT EXIST** | n/a | **MISSING ENDPOINT** |

Key error codes the FE must eventually map: `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED` (401); `NO_USABLE_INPUT`, `MALFORMED_CSV`, `EMPTY_CSV_DATA`, `MISSING_CSV_HEADER`, `TEXT_TOO_LONG`, `VALIDATION_ERROR` (422); `UNSUPPORTED_FILE_TYPE` (415); `FILE_TOO_LARGE`, `UPLOAD_ERROR`, `BAD_REQUEST`, `INVALID_INPUT` (400); `CASE_NOT_FOUND`, `ENTITY_NOT_FOUND`, `EDGE_NOT_FOUND`, `ROUTE_NOT_FOUND` (404); `CONFLICT` (409); `FASTAPI_TIMEOUT` (504); `FASTAPI_UNAVAILABLE`, `FASTAPI_UPSTREAM_ERROR`, `FASTAPI_INVALID_RESPONSE`, `FASTAPI_TRANSPORT_ERROR`, `PERSISTENCE_DATABASE_ERROR` (500/502).

---

## 6. Frontend Integration Status

| Area | File | Status | Existing impl | Missing integration | Target API |
|---|---|---|---|---|---|
| Login | `src/pages/LoginPage.jsx` | ✅ Complete | Form, validation, spinner, error banner, redirect | None | `POST /auth/login` |
| Auth state | `src/state/authContext.jsx` | ✅ Complete | login/logout/loading/error, sessionStorage persist | Optional: `verify()` on mount | `GET /auth/verify` |
| Protected routing | `src/App.jsx` | ✅ Complete | `PrivateRoute`, catch-all redirect | Route for `/cases/:caseId` (future step) | – |
| API client | `src/api/apiClient.js` | ✅ Complete | baseURL, 15s timeout, bearer, 401 wipe | Per-request timeout override (intake needs >30s later) | – |
| Case list | `src/pages/CaseListPage.jsx` | ⚠️ Placeholder | Nav bar, logout, "signed in" card only | Fetch cases, table/cards, loading/error/empty states | `GET /api/cases` (must be created) |
| Case intake | — | ❌ Absent | Nothing | Entire form: text area + CSV file picker + submit + result feedback | `POST /api/cases` |
| File upload | — | ❌ Absent | Nothing | `<input type="file">` → FormData multipart | `POST /api/cases` |
| Graph viz | — | ❌ Absent | **No graph lib installed** (pkg.json: axios/react/router/tailwind only) | Everything | `GET .../graph` |
| Timeline | — | ❌ Absent | Nothing | Everything | `GET .../timeline` |
| Entity details | — | ❌ Absent | Nothing | Everything | `GET .../entities/:id` |
| Guardrail/evidence | — | ❌ Absent | Nothing | Everything | `GET .../guardrail/:edgeId` |
| Loading states | LoginPage only | Partial | Spinner in login button | List/intake/graph variants | – |
| Error handling | Login only | Partial | Error banner pattern (reusable style) | Map backend `error.code` per feature | – |
| Empty states | — | ❌ Absent | DESIGN.md defines `ex-empty-state-card` chrome | Implement | – |

Do **not** rebuild: LoginPage, authContext, apiClient, PrivateRoute, the CaseListPage header/nav/logout chrome.

---

## 7. FastAPI Integration Status

Answering every audit question, from code:

- **Base URL**: `env.FASTAPI_BASE_URL` → default `http://127.0.0.1:8000` (`config/env.js:10`). `server/.env` does **not** set it → default active. `FASTAPI_INTERNAL_SECRET` unset → no `X-Internal-Secret` header sent.
- **Endpoint/method**: `POST {base}/case` (`fastApiClient.js:38,63`).
- **Request JSON**: `{ caseId, textReports: string[], csvRecords: object[] }` (`fastApiClient.js:41-45`).
- **Expected response**: object with `caseId`, `entities[]` (needs `canonicalId`,`type`), `relationships[]` (**hard invariant: every item MUST have non-empty `evidence[]`**, checked in `resultPersistenceService.validateFastApiResult`), `patterns[]`, `guardrail[]`; extra keys spread through (`fastApiClient.js:150-157`).
- **Timeout**: `FASTAPI_TIMEOUT_MS` default 30000 via AbortController (`fastApiClient.js:27,58-59`).
- **Error handling**: exhaustive taxonomy — `FASTAPI_CONFIG_ERROR` 500, `FASTAPI_TIMEOUT` 504, `FASTAPI_UNAVAILABLE` 502, `FASTAPI_TRANSPORT_ERROR` 502, `FASTAPI_UPSTREAM_ERROR` 502, `FASTAPI_INVALID_RESPONSE` 502 — all tested in `test_t08.js` Tests G/H/I.
- **Required for case creation?** **Yes, hard dependency.** `processCaseThroughFastApi` awaits it before persistence; there is **no production fallback**. Without it `POST /api/cases` always returns 502/504.
- **Mock/fallback**: only `tests/mockFastApiServer.js` (modes: success/timeout/error_500/error_400/invalid_json/empty; realistic fraud payload with evidence). Test-only — not wired into the app.
- **Runnable today?** The real FastAPI service is **not in this workspace** (glob `**/*.py` = 0 results). The Node side is runnable and proven against the mock.

**Classification: C — Backend-connected but frontend indirectly dependent, and the upstream service itself is MISSING from this repo (external dependency, "Argha's").** The integration seam (Node client) is fully done; the service is not locally runnable from this repository.

---

## 8. Database/Data Flow

**Models** (`server/src/models/`):

| Model | Collection | Key fields | Written by | Read by |
|---|---|---|---|---|
| `User` | users | username(unique,lower), password(hash,select:false), name, role | seed/login | auth |
| `Case` | cases | `caseId`(unique,idx), status(`pending/processing/completed/failed`), title, description, `sourceUploads[]`, metadata | persistence (upsert, status→completed, push upload rec) | graph/entity/timeline/guardrail (existence check) |
| `Entity` | entities | `caseId`, `canonicalId` (compound unique w/ caseId), type, aliases[], attributes(Mixed), confidence 0-1 | persistence (merge: aliases∪, attributes assign, max confidence) | graph, entity-detail |
| `Edge` | edges | `caseId`, `source`/`target` (=Entity.canonicalId, soft refs), `edgeType`, confidence, `timestamp`(domain), guardrailStatus/Rationale, attributes, **`evidence[]` REQUIRED non-empty** | persistence (dedupe key `{caseId,source,target,edgeType}`, evidence de-dupe by serialized item, max confidence) | graph, entity-detail (via `$or source/target`), timeline, guardrail (by `_id`+`caseId`) |
| `Pattern` | patterns | caseId, patternType, relatedEntityIds[], relatedEdgeIds[], confidence, description, severity enum, metadata | persistence (dedupe by caseId+patternType+description) | **NOTHING — no API reads patterns** |

**Relationships**: string-keyed scoping — everything hangs off `Case.caseId`; edges reference entity canonicalIds within the same case. Strict isolation enforced per-query (proven by test_t07 Cases A/B).

**Sample/test data**: none persistent. Test suites create + delete `CASE-TEST-*` artifacts. Only durable seed = default investigator. Whether Atlas db `emailscam` holds leftover real cases is unknown → the UI must treat empty as a first-class state.

**Actual current data flows**:

- **A. Authentication** — FE login → apiClient → auth route → controller → service → Mongo(users) → JWT → sessionStorage → bearer on subsequent calls. ✅ FULLY CONNECTED (your verification + code match).
- **B. Case intake** — ❌ BROKEN AT THE FIRST HOP: there is no FE submission UI at all. Backend chain (multer → controller → normalize/parse → FastAPI POST `/case` → validate evidence invariant → transactional upsert of Case/Entity/Edge/Pattern → 201) is complete and tested.
- **C. Graph** — ❌ FE side absent; backend `Case.findOne → Entity.find → Edge.find → shaped {nodes,edges}` ready.
- **D. Timeline** — ❌ FE absent; backend sorts edges asc, null-timestamp last, ready.
- **E. Entity detail** — ❌ FE absent; backend returns entity + `$or` scoped edges, ready.
- **F. Guardrail** — ❌ FE absent; backend returns edge + evidence + guardrailStatus/Rationale by ObjectId, ready.

---

## 9. Implemented but Not Connected

1. `POST /api/cases` (JSON + multipart) — no frontend form/uploader.
2. `GET /api/cases/:caseId/graph` — no renderer.
3. `GET /api/cases/:caseId/timeline` — no timeline UI.
4. `GET /api/cases/:caseId/entities/:entityId` — no detail panel.
5. `GET /api/cases/:caseId/guardrail/:edgeId` — no evidence view.
6. `GET /api/auth/verify` — implemented, never called by FE.

## 10. Missing Functionality

1. **`GET /api/cases` list endpoint** (backend) — blocks dashboard population and case discovery.
2. All case-domain frontend surfaces: intake form, upload, case workspace route (`/cases/:caseId`), graph viz, timeline, entity panel, guardrail/evidence drawer, empty/loading/error states for each.
3. Graph rendering library (nothing installed).
4. Patterns read API + UI (data persisted, never surfaced).
5. Token-expiry UX (auto-redirect on 401/TOKEN_EXPIRED; session re-validation on load).
6. Intake fields for `title`/`description` (schema supports; controller drops them).

## 11. Critical Issues / Risks

1. **Live credentials in `server/.env`** (MongoDB Atlas URI with username/password, db `emailscam`) — plaintext on disk and now shared in this chat. Recommend rotating the password and keeping `.env` git-ignored (root `.gitignore` exists; folder is not currently a git repo).
2. **Hard FastAPI dependency** — no intake E2E demo possible without the external service or the test mock; plan verification around `tests/mockFastApiServer.js`.
3. **Timeout mismatch trap** — axios client timeout is 15s (`apiClient.js:12`) but backend allows FastAPI 30s. When intake is wired naively, FE aborts at 15s while the backend succeeds later → confusing UX. Future intake step must override per-request timeout (>30s).
4. **JWT expires in 15m** with no refresh and no auto-redirect on expiry.
5. **`cors()` fully open** (`server.js:17`) — acceptable for dev, flag for prod.
6. **Edge identity omits timestamp** — repeated same-type interactions between two entities merge into one edge (evidence accumulates); affects timeline granularity. Design consequence, not a bug.
7. `App.jsx:24` reads `sessionStorage` directly in the catch-all route (bypasses context) — cosmetic inconsistency.

---

## 12. EXACT NEXT STEP

**Step: Turn the `/cases` placeholder into a real, backend-driven case dashboard — which requires first adding the missing `GET /api/cases` list endpoint.**

1. **What**: (a) Backend: add `GET /api/cases` returning all cases (newest first) with per-case `entitiesCount`/`edgesCount`. (b) Frontend: `CaseListPage` fetches it on mount via `apiClient` and renders populated / loading / error / empty states.
2. **Why this is correct now**: it is the smallest end-to-end slice; the dashboard is the post-login landing page and currently displays a static card; every later feature (workspace, graph, timeline) needs a `caseId` discovered from this list; it reuses the existing controller/service/envelope/auth stack with purely additive changes; and it is fully verifiable without FastAPI (read-only).
3. **Files to modify**:
   - `server/src/routes/case.routes.js` (add `router.get("/", authMiddleware, caseController.listCases)` — must be declared **before** the `/:caseId/*` routes)
   - `server/src/controllers/caseController.js` (add exported `listCases`)
   - `server/src/services/caseGraphService.js` (add `getCasesList()` beside the existing getters, reusing its model imports and error classes)
   - `frontend/src/pages/CaseListPage.jsx` (fetch + render + states)
4. **Files NOT to modify**: `authContext.jsx`, `apiClient.js`, `LoginPage.jsx`, `main.jsx`, all auth middleware/services/routes, FastAPI/persistence/intake services, models/schemas, test files.
5. **API contract (complete)**:

   - Request: `GET /api/cases`, header `Authorization: Bearer <jwt>` (auto-attached by `apiClient.js`). No query params required this step.
   - Response 200:

```json
{
  "success": true,
  "error": null,
  "data": {
    "total": 2,
    "cases": [
      {
        "caseId": "CASE-1787679000000-A3F8B1",
        "status": "completed",
        "title": null,
        "recordCount": 3,
        "uploadsCount": 1,
        "lastUploadAt": "2026-08-26T10:00:00.000Z",
        "entitiesCount": 2,
        "edgesCount": 1,
        "createdAt": "2026-08-26T10:00:00.000Z",
        "updatedAt": "2026-08-26T10:05:00.000Z"
      }
    ]
  }
}
```

   - Implementation guidance for the new service getter (`caseGraphService.getCasesList()`):
     - `Case.find({}).sort({ updatedAt: -1 }).lean()` (newest first).
     - Per-case `entitiesCount` / `edgesCount`: batch via two `aggregate` calls on `Entity` / `Edge` with `$match` + `$group by $caseId` (avoids N+1 queries), then map onto the case rows (default 0).
     - `recordCount` = sum of `sourceUploads[].recordCount`; `lastUploadAt` = max `sourceUploads[].uploadedAt` (both already stored by `resultPersistenceService.js:114-125`).
     - Reuse the file's existing `ValidationError` import pattern; wrap DB failures so `errorHandler.js` renders the standard envelope.
     - Route registration in `case.routes.js`: place `router.get("/", authMiddleware, caseController.listCases)` directly beneath `router.post("/", ...)`, above the `/:caseId/*` routes (no technical conflict today, but it keeps exact-match routing unambiguous and documents intent).

6. **What request the frontend sends:** exactly one call on mount — `apiClient.get('/cases')`. No body, no params; the interceptor injects the bearer token.

7. **What response the frontend expects:** the JSON above; code must defensively handle `res.data.data.cases` missing/not-an-array (treat as `[]`) and surface `err.response.data.error.message` on failure (same extraction pattern as `authContext.jsx:38`).

8. **What UI appears after success** (per `DESIGN.md`, reusing the existing page chrome):
   - Header/nav/logout stay exactly as-is (`CaseListPage.jsx:20-35`).
   - Below nav: mono eyebrow (`caption-mono`, uppercase, `#888888`) + display-sm headline (sentence-case, period-terminated, negative tracking) e.g. "Investigation cases."
   - **Populated**: a table using the `ex-data-table-cell` recipe — `canvas-soft` (#fafafa) header row with `caption-mono` uppercase column labels (CASE ID · STATUS · ENTITIES · EDGES · RECORDS · UPDATED), white body rows in `body-sm`, `#ebebeb` hairline row borders, `rounded-lg` container card with stacked-shadow chrome. Status renders as a `badge-secondary` pill: `completed` → `link-bg-soft`/blue text, `failed` → `error-soft`/`#c50000`, `pending|processing` → `warning-soft`/`#ab570a`. Rows render as buttons reserved for future navigation (no routing yet).
   - **Empty** (0 cases): `ex-empty-state-card` — `canvas-soft`, `rounded-lg`, generous padding, mono caption "No cases yet", body-sm line explaining intake arrives in the next step.
   - **Loading**: skeleton rows or the existing spinner pattern from `LoginPage.jsx:111`.
   - **Error**: banner in `error-soft`/`#c50000` (same style as `LoginPage.jsx:59-66`) showing backend message or a generic fallback, plus a small "Retry" button that re-runs the fetch.

9. **Errors / loading behavior:** local state machine `status: 'loading' | 'ready' | 'empty' | 'error'` set in `useEffect`. A 401 is already handled globally — `apiClient.js:31-40` wipes sessionStorage, `PrivateRoute` redirects to `/login` on next render; no special casing needed. Non-401 errors never clear the token.

10. **Manual verification:**
    1. Start backend (`cd server && npm run dev`) and frontend (`cd frontend && npm run dev`); login with `investigator` / `investigator123`.
    2. Fresh/empty DB → dashboard shows the empty-state card (not a crash, not a blank screen).
    3. Insert one test document into the `cases` collection (Atlas UI or mongosh) plus 1 entity + 1 edge with the same `caseId` → refresh → row appears newest-first with `entitiesCount: 1`, `edgesCount: 1`.
    4. Click Log out → manually visit `/cases` → bounced to `/login`.
    5. Stop backend, reload page → error banner + Retry; restart backend → Retry succeeds.
    6. curl cross-check: obtain token via `POST /api/auth/login`, then `curl -H "Authorization: Bearer <token>" http://localhost:5000/api/cases` and compare payload with the UI.
    7. Regression: login → logout → login again still works; `GET /health` still OK; all existing routes unchanged.

---

## 13. Ordered Integration Roadmap

**STEP 1 — Real case dashboard (list endpoint + wiring)** ← *immediate*
Goal: Replace the static `/cases` placeholder with live data.
Files: `server/src/routes/case.routes.js`, `server/src/controllers/caseController.js`, `server/src/services/caseGraphService.js`, `frontend/src/pages/CaseListPage.jsx`.
API: new `GET /api/cases` (contract above).
Expected result: Dashboard lists all cases with counts, sorted newest-first, with loading/error/empty states.
Manual verification: checklist in §12.10.

**STEP 2 — Case intake (text + CSV upload)**
Goal: Submit evidence and create a case from the UI.
Files: new `frontend/src/pages/` intake component (form section on dashboard or dedicated page), `frontend/src/App.jsx` (route only if new page), no backend changes.
API: `POST /api/cases` — FormData with CSV file(s) (any field name; backend uses `multer.any()`) and/or a `textReports` text field; **override axios timeout per-request** (`{ timeout: 60000 }`) because the shared client times out at 15s while FastAPI may take 30s (`fastApiClient.js:27`).
Expected result: On 201 → show returned `caseId` + `summary.entitiesCount/edgesCount/patternsCount` confirmation, refresh list. Map errors: 422 `NO_USABLE_INPUT`/`MALFORMED_CSV`, 415 `UNSUPPORTED_FILE_TYPE`, 400 `FILE_TOO_LARGE`, 502 `FASTAPI_UNAVAILABLE`/`FASTAPI_UPSTREAM_ERROR`, 504 `FASTAPI_TIMEOUT` → readable messages.
Manual verification: since the real FastAPI is external, run `node server/tests/mockFastApiServer.js`-style mock on port 8000 (default `FASTAPI_BASE_URL`) in success mode, submit via UI, confirm 201 + new row appears in the Step‑1 list; also submit garbage CSV → friendly inline error.

**STEP 3 — Case workspace + graph visualization**
Goal: Click a case row → `/cases/:caseId` workspace with the investigation graph.
Files: new `frontend/src/pages/CaseDetailPage.jsx`, `frontend/src/App.jsx` (protected route), `package.json` (**first and only dependency addition**: pick one viz lib — React Flow (`@xyflow/react`) recommended for React 19 fit; alternatives: cytoscape, d3-force).
API: `GET /api/cases/:caseId/graph` → render `nodes` (label = canonicalId, sublabel = type/aliases) and `edges` (label = edgeType, tooltip confidence/guardrailStatus). Handle 404 `CASE_NOT_FOUND`.
Expected result: Graph renders for the mock-data case from Step 2 (PERSON-001 ↔ BANK_ACCOUNT-001).
Manual verification: open workspace from list; compare node/edge counts against `curl` of the graph endpoint.

**STEP 4 — Timeline panel**
Goal: Chronological event list inside the workspace.
Files: new timeline component under `frontend/src/components/` or within `CaseDetailPage.jsx`.
API: `GET /api/cases/:caseId/timeline` → vertical list ascending by timestamp; events without timestamps grouped last under an "Undated" divider; each row: edgeType, source→target, timestamp, evidence-count chip.
Expected result: Ordering matches backend guarantee proven in `test_t07.js` Tests H–K.
Manual verification: counts and order match the graph edges; cross-case leakage impossible (isolation already tested).

**STEP 5 — Entity detail panel**
Goal: Click a graph node → side panel with the entity profile.
Files: new entity-panel component in the workspace.
API: `GET /api/cases/:caseId/entities/:entityId` → aliases, attributes (key/value grid), confidence indicator, related edges list.
Expected result: Panel data matches the selected node; 404 `ENTITY_NOT_FOUND` handled gracefully.
Manual verification: click each node; compare against raw endpoint response.

**STEP 6 — Guardrail / evidence drawer**
Goal: Click an edge or timeline event → evidence & guardrail view.
Files: new drawer component in the workspace.
API: `GET /api/cases/:caseId/guardrail/:edgeId` (note: `edgeId` = Edge `_id`, available as `id` on every edge/event object) → `guardrailStatus` badge (approved/flagged/unspecified), `guardrailRationale`, and `evidence[]` cards (sourceType, citation, field/value, record preview).
Expected result: Drawer opens with correct per-edge data; 404 `EDGE_NOT_FOUND` handled.
Manual verification: click several edges; verify evidence matches what the mock FastAPI returned in Step 2.

**STEP 7 — Session hardening polish (optional, last)**
Goal: Token-expiry UX.
Files: `frontend/src/state/authContext.jsx` (call `GET /api/auth/verify` on mount when a stored token exists), `frontend/src/api/apiClient.js` (on `TOKEN_EXPIRED`/401 also redirect to `/login`). Only touch after Steps 1–6 are stable; authentication logic itself remains as verified.

Priorities preserved throughout: reuse existing code, minimal diffs, API correctness, authentication preservation, error handling, manual verification after each step.

---

## 14. Manual Verification Plan

**Standing environment (every step):**
- Terminal 1: `cd server && npm run dev` → expect `[Server] … running` + `[Database] MongoDB Connected` + seeded-investigator log.
- Terminal 2: `cd frontend && npm run dev`.
- Terminal 3 (only for Step 2+): mock FastAPI on port 8000 until the real service is available.
- Credentials: `investigator` / `investigator123` (defaults from `config/env.js:15-16`; `server/.env` does not override them).

**Per-step gate:** a step is done only when (a) its happy path works in the browser, (b) its failure path shows the designed error state, (c) login→logout→login still works, (d) `curl` of the involved endpoint matches what the UI displays, (e) frontend `npm run lint` + `npm run build` pass.

**Final end-to-end acceptance run (after Step 6):**
login → create case via UI with text + CSV (mock FastAPI) → case appears in dashboard with correct counts → open workspace → graph shows mock entities/relationship → timeline shows the dated transaction event → entity panel shows Rahul Sharma aliases/attributes → guardrail drawer shows "approved" + citation → logout → login again → dashboard still lists the case.

---

## 15. Ready-to-Paste OpenCode Prompt

```text
TASK: Add a case-list API endpoint and wire it into the frontend dashboard (Integration Step 1 of the approved roadmap).

REPO CONTEXT
- Monorepo: ./server (Express 5 + Mongoose 9, port 5000) and ./frontend (Vite + React 19 + Tailwind 4 + axios).
- Authentication (JWT login, authMiddleware, apiClient interceptor, LoginPage, authContext) is COMPLETE and MANUALLY VERIFIED. Do NOT refactor or "improve" any of it.
- All responses use the standard envelope: success => { success:true, data, error:null }, error => { success:false, error:{ code, message } }. Follow it exactly.
- Frontend design MUST follow ./frontend/DESIGN.md tokens (canvas #ffffff, canvas-soft #fafafa, ink #171717, body #4d4d4d, mute #888888, hairline #ebebeb; mono caption eyebrows; stacked soft shadows; sentence-case headlines with negative tracking). Match the visual language already used in src/pages/LoginPage.jsx and src/pages/CaseListPage.jsx.

FILES TO INSPECT FIRST (read-only)
- server/server.js
- server/src/routes/case.routes.js
- server/src/controllers/caseController.js
- server/src/services/caseGraphService.js
- server/src/models/{Case,Entity,Edge}.js
- server/tests/test_t07.js (conventions for request helpers/envelopes)
- frontend/src/api/apiClient.js
- frontend/src/state/authContext.jsx
- frontend/src/App.jsx
- frontend/src/pages/CaseListPage.jsx
- frontend/DESIGN.md

FILES YOU MAY MODIFY OR CREATE (nothing else)
- MODIFY: server/src/routes/case.routes.js  -> add: router.get("/", authMiddleware, caseController.listCases); placed directly below router.post("/", ...).
- MODIFY: server/src/controllers/caseController.js -> add exported async listCases controller: call getCasesList(), return res.status(200).json({ success:true, data, error:null }); errors via next(error).
- MODIFY: server/src/services/caseGraphService.js -> add exported getCasesList(): Case.find({}).sort({ updatedAt:-1 }).lean(); compute per-case entitiesCount and edgesCount using two aggregate pipelines on Entity and Edge ($group by $caseId) merged onto results (default 0); derive recordCount = sum of sourceUploads[].recordCount, lastUploadAt = latest sourceUploads[].uploadedAt, uploadsCount = sourceUploads.length. Return { total, cases:[{ caseId, status, title, recordCount, uploadsCount, lastUploadAt, entitiesCount, edgesCount, createdAt, updatedAt }] }. Do NOT change existing functions.
- MODIFY: frontend/src/pages/CaseListPage.jsx -> keep the existing header/nav/logout markup untouched; replace the placeholder card body with a data-fetching dashboard:
  * On mount: apiClient.get('/cases') (token auto-attached; do not add auth logic).
  * State machine: 'loading' | 'ready' | 'empty' | 'error'.
  * ready: table per ex-data-table-cell recipe — canvas-soft header, caption-mono uppercase labels CASE ID / STATUS / ENTITIES / EDGES / RECORDS / UPDATED, hairline row borders, body-sm cells; STATUS as a pill: completed=link-bg-soft/blue, failed=error-soft/#c50000, pending|processing=warning-soft/#ab570a. Rows are buttons (no navigation yet).
  * empty: ex-empty-state-card style — canvas-soft rounded-lg card, mono caption "No cases yet", one body-sm explanatory line.
  * loading: skeleton rows or the spinner pattern from LoginPage.
  * error: banner styled like LoginPage's error banner showing error.response?.data?.error?.message or a generic fallback, plus a Retry button refetching.
- CREATE (optional, allowed): server/tests/test_t09_case_list.js following the exact helper/style conventions of test_t07.js: seed 2 cases (A newer than B) + entities/edges for A only, assert 200 newest-first ordering, correct counts, strict case isolation, 401 without/invalid token, then clean up.

DO NOT MODIFY
- Any auth file: authMiddleware, authController, authService, auth.routes.js, authContext.jsx, LoginPage.jsx, main.jsx.
- frontend/src/api/apiClient.js, App.jsx, models/schemas, FastAPI/intake/persistence services, package.json (NO new dependencies), vite.config.js, existing tests.

ACCEPTANCE CHECKS (run them, report results)
- Backend: start `npm run dev` in ./server (requires the configured MongoDB). Login via POST /api/auth/login {username:"investigator",password:"investigator123"} to get a token; curl GET /api/cases with and without the Bearer token; confirm 200 envelope + counts, and 401 envelope without token. Run node server/tests/test_t09_case_list.js if created.
- Frontend: `npm run lint` and `npm run build` in ./frontend must pass with zero errors. Manually reason through loading/empty/error/populated rendering.
- Regression: confirm POST /api/cases, graph, timeline, entity, guardrail routes are byte-for-byte unchanged in behavior.

REPORT BACK
List every file changed/created with a one-line summary of the change, paste the final GET /api/cases response for your seeded test data, paste lint/build/test outputs, and explicitly confirm no auth-related file was modified.
```

---

**Audit closed.** Immediate action: hand OpenCode the §15 prompt; do not proceed to Step 2 until Step 1 passes its §14 gate.
