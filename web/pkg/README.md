# Hush Network STARK Demo

[![CI](https://github.com/Hush-Network/stark-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/Hush-Network/stark-demo/actions/workflows/ci.yml)

**[Try it live at demo.hushnetwork.io](https://demo.hushnetwork.io)**

This repository contains the STARK proving engine and browser demo behind the public HushPay proof demo. It proves the core payment, credential issuance, and time-window audit circuits over Mersenne31 with no trusted setup. It does not prove a live network.

Built on [Stwo](https://github.com/starkware-libs/stwo) (FRI-based STARK prover, Mersenne31 field) with Poseidon2 as the in-circuit hash.

## Relationship to the browser demo

The live demo opens directly into the intended HushPay wallet experience: the sender sees amount, fee route, and total debit up front while the receiver gets the full payment amount.

This repository provides the proof engine underneath that experience: payment validity, credential checks, audit proofs, and receipt verification. Wallet funding, credential issuance, and live network submission remain represented in the demo.

## Status boundary

**Implemented**
- Payment, credential issuance, and time-window audit circuits
- Browser WASM bindings used by the live demo
- Proof generation and proof verification for the payment circuit
- Test suite for circuit correctness

**Benchmarked**
- Native prove and verify timings for all three circuits
- Browser WASM timings for the payment circuit
- Trace layout and circuit size estimates

**Target-state**
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

## What each circuit proves

| Circuit | What it proves |
|---------|----------------|
| Payment | The sender owns the input notes, the credential is valid, and the amounts balance. Sender, receiver, and amount stay hidden. |
| Credential Issuance | This wallet was authorized by a verified issuer to participate in the network. |
| Time-Window Audit | This wallet transacted a specific total volume between two timestamps, without revealing individual transactions. |

## Circuits

Three STARK circuits on Stwo over Mersenne31, with full Poseidon2 AIR constraints (S-box decomposed as x^2 -> x^4 -> x^5 for degree-2 constraint compatibility).

**Payment circuit** (2-in-2-out private transfer with credential check)
- Note consumption and creation with nullifier/commitment pairs
- Balance conservation enforced in-circuit
- Nullifier inequality check (prevents double-spend)
- Amount range checks (four 15-bit limbs per amount, radix 2^15, with carry-propagation conservation)
- Credential verification: issuer, expiry, and Merkle inclusion checked inside the proof
- Three depth-20 Merkle path verifications per transaction (2 note paths + 1 credential path)
- ~44,400 trace columns

**Credential issuance circuit**
- Derives issuer identity from private key via Poseidon2
- Computes credential commitment over (issuer, subject, expiry, secret)
- Verifies issuer Merkle inclusion (depth-20)
- ~14,000 trace columns

**Time-window audit circuit** (16 transaction slots)
- Proves aggregate volume over a time window without revealing individual transactions
- Per-transaction: binary window flag, conditional contribution, 24-bit timestamp range checks
- Sum constraint: contributions equal claimed total
- Credential verification with expiry range check
- Merkle inclusion for credential set

## What the payment circuit proves

Owner derivation, input/output note commitments, Merkle inclusion (2 note paths + 1 credential path), nullifier derivation and uniqueness, balance conservation, credential validity (commitment + expiry range check + Merkle inclusion), and credential nullifier binding.

Public outputs bound via Fiat-Shamir: nullifiers, output commitments, credential nullifier. Everything a validator would need to update ledger state.

## Performance

Measured on AMD Ryzen 9 / release build. 10 iterations per circuit. Single-threaded, no batching, no recursion.

| Circuit             | Prove (avg) | Prove (min) | Prove (max) | Verify (avg) |
|---------------------|-------------|-------------|-------------|--------------|
| Payment             |     1058ms  |     1021ms  |     1092ms  |       128ms  |
| Mode A Bundle       |     1152ms  |     1121ms  |     1182ms  |       125ms  |
| Mode B Bundle       |     1826ms  |     1781ms  |     1872ms  |       205ms  |
| Credential Issuance |      281ms  |      270ms  |      289ms  |   (combined) |
| Time-Window Audit   |      324ms  |      316ms  |      344ms  |   (combined) |

Native: AMD Ryzen 9, release build, April 12 2026. Mode A = same-asset fee. Mode B = HUSH sidecar fee (payment + fee sidecar proofs). Accounting, epoch accrual, and payout generation run in sub-microsecond time and are not shown.

Recursive batching and multi-threading are target-state optimizations, not measured here. See [benchmarks/](benchmarks/) for the full breakdown.

Fixed-width amount encoding means payment size does not change the circuit shape within the supported amount range. That is why the current browser demo can already say something meaningful about large-value payment latency even before batching or recursion is implemented.

## Tests

113 tests covering:
- Valid proof generation and verification for all three circuits
- Balance conservation rejection (mismatched inputs/outputs)
- Nullifier reuse rejection (double-spend prevention)
- Expired credential rejection
- Unauthorized issuer rejection
- Invalid time window rejection
- Mismatched audit total rejection
- Poseidon2 AIR correctness (output verification, column count validation)
- Owner derivation consistency

## Cryptographic stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Proving system | STARK (FRI) | Transparent, no trusted setup, post-quantum |
| Prover | Stwo | Fastest production STARK prover, Rust, open source |
| Field | Mersenne31 (M31) | Native to Stwo, fast field arithmetic |
| In-circuit hash | Poseidon2 (width-16, Plonky3 constants) | STARK-optimized, efficient over M31 |
| Commitment backend | Poseidon252 (native) / Blake2s (WASM) | Native build stays algebraic; WASM uses a compatible fallback |

## Repository structure

```
src/
  circuit.rs              Payment circuit (2-in-2-out)
  credential_issuance.rs  Credential issuance circuit
  time_window.rs          Time-window audit circuit
  poseidon2.rs            Poseidon2 hash (M31, width-16, domain-separated)
  poseidon2_air.rs        Poseidon2 AIR constraints
  types.rs                Witness types
  wasm.rs                 WASM bindings (compiled to power the browser demo)
  prover_common.rs        Shared prover utilities
  bin/
    bench.rs              Benchmark suite
    lifecycle.rs          Full protocol flow demo
docs/
  architecture.md         Circuit architecture and proving notes
benchmarks/
  BENCHMARK_REPORT_2026-04-07.md  Latest benchmark run with measured, inferred, and target sections (refreshed April 12, 2026)
  BENCHMARK_REPORT_2026-04-02.md  Previous baseline (pre-multi-limb)
```

## Development

```bash
scripts/test.sh     # run tests (113 tests)
scripts/bench.sh    # benchmarks
scripts/fmt.sh      # format
cargo clippy -- -D warnings
```

```bash
cargo run --bin lifecycle --release   # full protocol flow demo
cargo run --bin bench --release       # performance benchmarks
```

## Scope notes

This crate is the proving engine for Hush Network. It does not implement:

- Consensus
- Fee extraction
- Validator incentives
- Note discovery
- Consumer wallet flows beyond the browser demo

See [docs/architecture.md](docs/architecture.md) for circuit architecture notes and [benchmarks/BENCHMARK_REPORT_2026-04-07.md](benchmarks/BENCHMARK_REPORT_2026-04-07.md) for the measured versus target breakdown. That report was refreshed with a new local run on April 12, 2026.

## Prior art

- **Zcash** (Sapling/Orchard): note model, nullifier design, selective disclosure lineage
- **Penumbra**: shielded UTXO model, private eligibility-gating concepts
- **Aztec**: private execution model, compliance integration patterns
- **Stwo** (StarkWare): prover architecture, FRI over Mersenne31
- **Poseidon2** (Grassi et al.): STARK-friendly hash construction

## License

MIT
