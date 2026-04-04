# Benchmark Report - April 2, 2026

**Hardware:** AMD Ryzen 9, release build  
**Prover:** Stwo (FRI-based STARK, Mersenne31)  
**Iterations:** 10 per circuit  
**Mode:** Single-threaded, no batching, no recursion  
**Field:** Mersenne31 (M31)  
**Merkle depth:** 20

---

## Measured

Results from `cargo run --bin bench --release`:

| Circuit | Prove (avg) | Prove (min) | Prove (max) | Verify (avg) |
|---|---|---|---|---|
| Payment (2-in-2-out) | 847ms | 796ms | 949ms | 113ms |
| Credential Issuance | 277ms | 269ms | 287ms | (combined) |
| Time-Window Audit (16 slots) | 286ms | 275ms | 300ms | (combined) |

Browser (WASM, modern desktop browser, measured separately from the bench suite):
- Payment prove: ~1.2s
- Payment verify: ~20ms

Commitment backend:
- Native (bench suite): Poseidon252
- WASM (browser demo): Blake2s

Note: The previous benchmark run on March 31, 2026 showed 906ms average / 850ms minimum for Payment. The April 2 run shows 847ms average / 796ms minimum. The improvement is real, but both runs are still single-threaded baseline measurements.

---

## Inferred

Values derived from benchmark data and circuit analysis. They are not directly measured as isolated units.

| Metric | Value | Derivation |
|---|---|---|
| Per-note gas (trace columns) | ~8,000 | (44,000 - 13,000) / 4 notes = 7,750, rounded to ~8,000 |
| Base overhead per transaction | ~13,000 | Credential issuance circuit trace count used as the overhead component |
| Amortized verify cost (recursive, projected) | ~1ms per tx | Estimated at a 100-tx batch; requires recursion and is not implemented |

Actual circuit trace column counts (from code analysis, not bench output):
- Payment (2-in-2-out): ~44,192 columns (base 26 + range checks 84 + hash intermediates 5,724 + Merkle paths 38,340)
- Credential issuance: ~14,058 columns (base 6 + hash intermediates 1,272 + Merkle path 12,780)
- Time-window audit (16 slots): ~14,942 columns

These differ slightly from rounded values in documentation (~44,000 and ~14,000 respectively). The payment circuit is within acceptable rounding. Credential issuance should be described as ~14,000, not ~13,000.

---

## Target / Design Goal

Not yet measurable. Requires components that are not built yet.

| Metric | Target | Requires |
|---|---|---|
| TPS (baseline, single-threaded verify) | 100+ | Consensus + basic node |
| TPS (with recursive aggregation) | 1,000+ | Recursive STARK (one proof per block) |
| TPS (post-mainnet, sharded) | 10,000+ | Sharded state, parallel proving, L1 optimizations |
| Block finality | ~2s | HotStuff-2 BFT (designed, not built) |
| Est. tx fee (standard payment) | ~$0.005 USD equiv. | Gas model designed; fee extraction not yet in circuit |
| Recursive verify latency | ~1ms amortized | Recursive aggregation |

---

## Not measured / not implemented

The following are outside the scope of this benchmark run:

- Consensus throughput
- Block finality
- Protocol fee extraction
- Mixed-asset fee routing for ordinary payment fees
- Validator compensation
- Full revocation path
- Recursive aggregation in production
- Note discovery

---

## Context

The payment circuit at 847ms native single-threaded proving is a credible baseline for a full STARK proof over a ~44,000-column trace with three depth-20 Merkle paths and nine Poseidon2 hash traces. This is one transaction, one thread, no batching, no recursion.

The path to 1,000+ TPS runs through recursive proof aggregation: one STARK proof per block covering all transactions. At that point, per-block verify cost becomes constant with respect to block size, and per-transaction verification can be amortized to roughly 1ms. That is a design target, not a measured result.

At ~1.2s browser proving on desktop hardware, client-side proving is already usable for a demo. It is not yet production wallet UX. The next gap is reducing prove time materially through circuit optimization, Stwo improvements, and optional delegated proving protocols.

The stablecoin-denominated fee preview shown in the live wallet demo is product-direction UX. This report does not measure or validate that fee-routing path.
