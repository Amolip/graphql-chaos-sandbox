# GraphQL Performance & Chaos Engineering Sandbox

[![Angular 22](https://img.shields.io/badge/Angular-22.2_Signals-dd0031?logo=angular)](https://angular.dev)
[![Angular Material](https://img.shields.io/badge/Material-22.2_Stepper_%26_Tree-0ea5e9)](https://material.angular.io)
[![NestJS](https://img.shields.io/badge/NestJS-11_%2B_Apollo_Server-e0234e?logo=nestjs)](https://nestjs.com)
[![GraphQL](https://img.shields.io/badge/GraphQL-AST_%26_DataLoader-e10098?logo=graphql)](https://graphql.org)

An interactive **GraphQL Performance & Chaos Engineering DevTools Sandbox** engineered with **Angular 22 Signals**, **Angular Material (`MatStepper` & `MatTree`)**, **Custom Interactive SVGs**, and **NestJS + Apollo Server Plugins**.

🔗 **Live Interactive Sandbox:** [https://amolip.github.io/graphql-chaos-sandbox/](https://amolip.github.io/graphql-chaos-sandbox/)

---

## Architectural Highlights

### 1. Angular 22 + Angular Material DevTools UI
- **Interactive SVG Flamegraphs & Resolver Waterfalls (`FlamegraphSvgComponent`):**
  - Built purely with **Angular 22 Signals (`signal`, `computed`, `input`, `output`)** and hardware-accelerated SVG `<rect>` / `<linearGradient>` primitives.
  - Supports **Resolver Execution Waterfall** and **Depth Stack Icicle Flamegraph** modes, real-time span path filtering, interactive zoom (`100%` – `250%`), and color-coded span classification (`Batched O(1)`, `Unbatched N+1 SQL Hit`, `Chaos Latency / Jitter`, `Injected Partial Failure`).
- **Interactive SVG Resolver Dependency & Fan-Out Graph (`DependencyTreeSvgComponent`):**
  - Renders cubic Bézier curves connecting parent operations to nested object/list resolvers, dynamically highlighting list multipliers (`×5`, `×12`) and $N+1$ risk levels (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- **Custom Angular Material `MatStepper` & `MatTree` AST Inspector (`AstInspectorComponent`):**
  - **Pre-Execution AST Gatekeeper (`MatStepper`):** Walks through `1. Lexical & Syntactic AST Parse`, `2. Query Depth Gatekeeper`, `3. Cost & List Multiplier Static Analysis`, and `4. N+1 Resolver Fan-out Predictor` with microsecond timing and `PASS` / `WARN` / `BLOCK` badges.
  - **Deep AST `DocumentNode` Explorer (`MatTree`):** Recursive tree view for inspecting deeply nested GraphQL selection sets, inline/named fragments, field arguments, and per-node computed complexity costs.
- **Traffic Spike & Concurrency Burst Simulator (`TrafficSpikeSvgComponent`):**
  - Simulates concurrent virtual users (`5` – `120 VUs`) and request waves (`20` – `200 reqs`), plotting `P50`, `P95`, and `P99` tail latencies, sustained `req/s` throughput, and database connection pool saturation.

### 2. NestJS + GraphQL + Custom Apollo Server Plugin
- **Static AST Complexity & Depth Analyzer (`AstComplexityAnalyzer`):**
  - Parses incoming GraphQL query documents into a `DocumentNode` AST using `graphql`'s `parse()` before execution.
  - Recursively evaluates selection sets and fragment spreads to compute **Query Depth** and **Weighted Complexity Scores** (accounting for list arguments such as `limit`, `first`, `take`) and predicts $N+1$ fan-out bottlenecks.
- **Custom Apollo Server Plugin (`TracingChaosApolloPlugin`):**
  - Hooks into `requestDidStart`, `didResolveOperation`, `executionDidStart`, `willResolveField`, and `willSendResponse` using `process.hrtime.bigint()` nanosecond precision.
  - Captures per-resolver execution offsets, durations, parent/return types, and attaches the full `sandboxTelemetry` payload inside the GraphQL `extensions` response object.
- **$N+1$ Query Bottleneck vs Request-Scoped `DataLoader<K, V>` (`SandboxService`):**
  - Toggle between **Unbatched $N+1$ Execution** (where nested `Order -> customer`, `items -> product -> seller / reviews / warehouses` fire 45+ individual SQL/RPC queries) and **Request-Scoped `DataLoader` Batching** (which coalesces lookups within a single Node.js event-loop tick into 5–6 batched queries).
- **Chaos Monkey Fault Injection Engine:**
  - Inject synthetic resolver latency spikes (`LATENCY_SPIKE`), random network tail jitter (`PACKET_JITTER`), database connection pool contention (`DB_POOL_EXHAUSTION`), or probabilistic subgraph `GraphQLError` partial failures (`PARTIAL_FAILURE`) via the `x-chaos-config` HTTP header or control deck.

---

## Quick Start (Full-Stack Local Mode)

```bash
# 1. Start the NestJS GraphQL + Apollo Tracing API on port 3333
cd api
npm install --legacy-peer-deps
npm run start:dev

# 2. Start the Angular 22 DevTools Frontend on port 4201
cd ../web
npm install --legacy-peer-deps
npm start
```

Open **`http://localhost:4201`** in your browser.
- When the NestJS API is running on `http://localhost:3333/graphql`, the UI connects in **`LIVE_NESTJS`** mode and streams real Apollo Server plugin `extensions.sandboxTelemetry` traces.
- When hosted statically on GitHub Pages, the UI automatically falls back to its built-in **In-Browser Deterministic AST & Chaos Engine** so every interactive flamegraph, AST tree, and chaos control works zero-setup in the browser.

---

## Running Backend Unit Tests

```bash
cd api
npm test
```
