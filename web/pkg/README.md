# Hush Network STARK Demo

[![CI](https://github.com/Hush-Network/stark-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/Hush-Network/stark-demo/actions/workflows/ci.yml)

**[Try it live at demo.hushnetwork.io](https://demo.hushnetwork.io)**

This repository contains the STARK proving engine, WASM boundary, and browser demo behind the public HushPay proof artifact. It implements the current payment, provenance attestation, and time-window audit circuits over Mersenne31 with no trusted setup. It does not implement a live network.

Built on [Stwo](https://github.com/starkware-libs/stwo) (FRI-based STARK prover, Mersenne31 field) with Poseidon2 as the in-circuit hash.

## Relationship to the browser demo

The `web/` directory is a browser demo that calls the proving engine through `src/wasm.rs`.

What is real in this repo:
- payment proof generation and verification
- provenance attestation proof generation
- audit proof generation and verification
- the quote / submit runtime used by the browser demo

What remains demo scaffolding in this repo:
- browser fixture balances, handles, and default recipients
- single-leaf attestation setup in the `prove_demo_*` WASM helpers
- in-memory wallet state and transaction history

Wallet funding, live boundary-issued attestations, and network submission are represented in the demo but not implemented here as production integrations.

Supported browser payment assets are USDC and USDT. HUSH remains only the sidecar fee asset and demo gas reserve; the standalone HUSH-payment route is not part of this repo's current model.

## Status boundary

**Implemented**
- Payment, provenance attestation, and time-window audit circuits
- Browser WASM bindings used by the live demo
- Proof generation and proof verification for the payment circuit
- Test suite for circuit correctness

**Benchmarked**
- Native prove and verify timings for all three circuits
- Browser WASM timings for the payment circuit
- Trace layout and circuit size estimates

**Broader Hush architecture**
- Recursive proof aggregation
- HotStuff-2 BFT consensus
- Threshold-encrypted mempool
- Structured note discovery
- Full revocation path

**Not implemented**
- Live validator network
- Protocol fee extraction
- Validator incentives
- Production wallet SDK

## Demo fixtures and boundaries

- `src/` contains the proof engine, circuit logic, hash primitives, and WASM exports.
- `web/src/api/wasm-adapter.js` is the browser-side WASM boundary.
- `web/src/config/demo-fixtures.js` contains explicit demo-only fixture values.
- `web/src/state/demo-state.js` contains browser-only wallet state.

If a reviewer wants the cleanest scope boundary, start with [`docs/current-scope.md`](docs/current-scope.md).

## What each circuit proves

| Circuit | What it proves |
|---------|----------------|
| Payment | The sender owns the input notes, both input notes carry the same attestation root, the note paths resolve against the published note root, and the amounts balance. Sender, receiver, and amount stay hidden. |
| Provenance Attestation | The note carries a valid attestation signed by a screened boundary actor (exchange, bridge, issuer, PSP, merchant) at entry. |
| Time-Window Audit | This wallet transacted a specific total volume between two timestamps, surfaced to the user as an audit proof, without revealing individual transactions. |

## Circuits

Three STARK circuits on Stwo over Mersenne31, with full Poseidon2 AIR constraints (S-box decomposed as x^2 -> x^4 -> x^5 for degree-2 constraint compatibility).

**Payment circuit** (2-in-2-out private transfer with attestation-root continuity)
- Note consumption and creation with nullifier/commitment pairs
- Balance conservation enforced in-circuit
- Nullifier inequality check (prevents double-spend)
- Amount range checks (four 15-bit limbs per amount, radix 2^15, with carry-propagation conservation)
- Provenance continuity: both consumed notes must carry the same attestation root and both created notes inherit it
- Two depth-20 Merkle path verifications per transaction (note paths only)
- Published accumulator root and epoch are bound into the proof transcript, but v1 does not yet enforce in-circuit non-revocation
- ~44,400 trace columns

**Provenance attestation circuit**
- Derives boundary actor identity from private key via Poseidon2
- Computes attestation commitment over (boundary actor, recipient note, attestation parameters, secret)
- Verifies boundary actor Merkle inclusion (depth-20)
- ~14,000 trace columns

**Time-window audit circuit** (16 transaction slots)
- Proves aggregate volume over a time window without revealing individual transactions
- Per-transaction: binary window flag, conditional contribution, 24-bit timestamp range checks
- Sum constraint: contributions equal claimed total
- Provenance attestation verification across the audited transactions
- Merkle inclusion for the boundary actor set

## What the payment circuit proves

Owner derivation, input/output note commitments, note-path inclusion for both consumed notes, nullifier derivation and uniqueness, balance conservation, and provenance continuity via shared attestation root inheritance.

Public outputs bound via Fiat-Shamir: note root, accumulator root, epoch, binding data, nullifiers, and output commitments. The accumulator root is bound to the proof state, but it is not yet consumed by an in-circuit non-revocation check in the payment path.

## Performance

### Browser (WASM)

The live demo at demo.hushnetwork.io runs the full prover in the browser via WebAssembly. The latest separately measured Chrome average on AMD Ryzen 9 remains:

| Circuit             | Prove (avg) |
|---------------------|-------------|
| Payment             |      ~334ms |

WASM uses Blake2s for the Merkle commitment backend (no SIMD Poseidon252 in browser). Payment amount does not affect proving time due to fixed-width trace layout.

### Native (single-threaded)

Local Windows workstation, release build. 10 iterations per circuit. Refreshed May 13, 2026.

| Circuit             | Prove (avg) | Prove (min) | Prove (max) | Verify (avg) |
|---------------------|-------------|-------------|-------------|--------------|
| Payment             |    642.64ms |    596.33ms |    718.79ms |     75.47ms |
| Payment Bundle      |   1319.44ms |   1271.73ms |   1423.26ms |    155.09ms |
| Provenance Attest.  |    275.36ms |    271.02ms |    279.84ms |  (combined) |
| Time-Window Audit   |    284.35ms |    271.56ms |    308.18ms |  (combined) |

### Native (parallel, --features parallel)

Same workstation, multi-threaded via rayon. Refreshed May 13, 2026.

| Circuit             | Prove (avg) | Prove (min) | Prove (max) | Verify (avg) |
|---------------------|-------------|-------------|-------------|--------------|
| Payment             |    353.98ms |    294.20ms |    424.12ms |     76.14ms |
| Payment Bundle      |    804.21ms |    757.65ms |    892.76ms |    158.64ms |
| Provenance Attest.  |    159.45ms |    151.59ms |    173.64ms |  (combined) |
| Time-Window Audit   |    150.41ms |    140.13ms |    176.66ms |  (combined) |

Payment Bundle is the current public demo path: stablecoin payment plus HUSH gas sidecar proof. Accounting, epoch accrual, and payout generation run in microseconds and are shown in [benchmarks/](benchmarks/).

Recursive batching is a later proving path within the broader Hush architecture and is not measured here. See [benchmarks/](benchmarks/) for the full breakdown.

Fixed-width amount encoding means payment size does not change the circuit shape within the supported amount range. That is why the browser demo can say something meaningful about large-value payment latency even before batching or recursion is implemented.

## Tests

`cargo test` covers:
- Valid proof generation and verification for all three circuits
- Balance conservation rejection (mismatched inputs/outputs)
- Nullifier reuse rejection (double-spend prevention)
- Unauthorized boundary-actor rejection
- Invalid time window rejection
- Mismatched audit total rejection
- Poseidon2 AIR correctness (output verification, column count validation)
- Owner derivation consistency

## Cryptographic stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Proving system | STARK (FRI) | Transparent, no trusted setup, post-quantum |
| Prover | Stwo | Open-source Rust STARK prover with fast Mersenne31 support |
| Field | Mersenne31 (M31) | Native to Stwo, fast field arithmetic |
| In-circuit hash | Poseidon2 (width-16, Plonky3 constants) | STARK-optimized, efficient over M31 |
| Commitment backend | Poseidon252 (native) / Blake2s (WASM) | Native build stays algebraic; WASM uses a compatible fallback |

## Repository structure

```
src/
  circuit.rs                Payment circuit (2-in-2-out, with attestation-root continuity)
  provenance_attestation.rs Provenance attestation circuit
  time_window.rs            Time-window audit circuit
  poseidon2.rs              Poseidon2 hash (M31, width-16, domain-separated)
  poseidon2_air.rs          Poseidon2 AIR constraints
  payment_tx.rs             Canonical payment transaction encoding and binding hash
  payment_validation.rs     Payment + fee bundle validation
  payment_fixtures.rs       Shared fixtures for tests, lifecycle, and bench
  fee_sidecar.rs            HUSH fee sidecar circuit
  hush_gas_runtime.rs       Quote/submit runtime for stablecoin payments with HUSH gas
  accounting.rs             Block accounting and validator payout primitives
  measurement.rs            Duration/timing helpers
  types.rs                  Witness types and shared constants
  wasm.rs                   WASM bindings (compiled to power the browser demo)
  prover_common.rs          Shared prover utilities
  bin/
    bench.rs                Benchmark suite
    lifecycle.rs            Full protocol flow demo
docs/
  architecture.md           Circuit architecture and proving notes
benchmarks/
  BENCHMARK_REPORT_2026-04-17.md  Latest benchmark run: native and parallel refresh, plus current WASM note
  BENCHMARK_REPORT_2026-04-07.md  Prior benchmark snapshot
  BENCHMARK_REPORT_2026-04-02.md  Earlier baseline (pre-multi-limb)
```

## Development

```bash
cargo run --bin lifecycle --release                   # full protocol flow
cargo run --bin bench --release                       # benchmarks (single-threaded)
cargo run --bin bench --release --features parallel   # benchmarks (multi-threaded)
cargo test
cargo fmt -- --check
cargo clippy -- -D warnings
```

### WASM build

```bash
wasm-pack build --target web --out-dir web/pkg
cd web && npm ci && npx vite build
```

### CI

Push to `main` triggers fmt, clippy, test, audit, wasm-build, and web-build jobs. Cloudflare Pages deploys the web build automatically on push.

## Scope notes

This crate is the proving engine for Hush Network. It does not implement:

- Consensus
- Fee extraction
- Validator incentives
- Note discovery
- Consumer wallet flows beyond the browser demo

See [docs/architecture.md](docs/architecture.md) for circuit architecture notes and [benchmarks/BENCHMARK_REPORT_2026-04-17.md](benchmarks/BENCHMARK_REPORT_2026-04-17.md) for the current breakdown including WASM notes plus refreshed single-threaded and parallel native results.

## Prior art

- **Zcash** (Sapling/Orchard): note model, nullifier design, selective disclosure lineage
- **Penumbra**: shielded UTXO model, fund-level enforcement concepts
- **Aztec**: private execution model, compliance integration patterns
- **Stwo** (StarkWare): prover architecture, FRI over Mersenne31
- **Poseidon2** (Grassi et al.): STARK-friendly hash construction

## License

MIT
