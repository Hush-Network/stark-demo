# Current Scope

What this repository implements today, what is demo scaffolding, and what is intentionally not implemented here. The intent is to make the boundary between cryptographic/protocol code and browser demo scaffolding obvious to a reviewer.

## Implemented today

- **Payment circuit** (`src/circuit.rs`): 2-in-2-out private transfer with attestation-root continuity across consumed and created notes, balance conservation across four 15-bit limbs per amount, nullifier derivation and inequality, and depth-20 Merkle path verification for both note inputs.
- **Provenance attestation circuit** (`src/provenance_attestation.rs`): proves a private note carries an attestation signed by an approved boundary actor with Merkle inclusion in the boundary actor set.
- **Time-window audit circuit** (`src/time_window.rs`): proves aggregate volume across up to 16 transactions in a defined window, surfaced to the user as an audit proof.
- **Poseidon2 hash + AIR** (`src/poseidon2.rs`, `src/poseidon2_air.rs`): width-16 over Mersenne31, with degree-2 constraint decomposition for in-circuit verification. Constants verified against Plonky3 vectors.
- **Payment tx encoding + binding hash** (`src/payment_tx.rs`): canonical encoding of payment + fee descriptors and the binding-hash domain separation used by every transaction proof.
- **Payment + fee bundle validation** (`src/payment_validation.rs`): validates a (payment, fee sidecar) bundle end to end before submission.
- **HUSH fee sidecar** (`src/fee_sidecar.rs`): independent proof that pays the protocol fee in HUSH against the same binding hash as the payment.
- **HUSH gas runtime** (`src/hush_gas_runtime.rs`): quote and submit paths exposed to the browser demo. The browser route is stablecoin payment with HUSH gas.
- **Block accounting** (`src/accounting.rs`): payment-fee accounting and validator payout primitives.
- **Browser WASM bindings** (`src/wasm.rs`): narrow surface used by the live demo. Exports cover proof construction, proof verification, audit-proof construction and verification, the HUSH gas quote/submit flow, and a binding-hash recompute helper used by the receipt verifier.
- **Browser demo** (`web/`): wallet shell, payment composer, audit overlay, receipt verifier. Uses Vite for build.
- **Native benchmarks** (`src/bin/bench.rs`): single-threaded and `--features parallel` paths for all three circuits.
- **Lifecycle binary** (`src/bin/lifecycle.rs`): end-to-end attestation -> payment -> audit flow over native code.
- **Test suite** (`cargo test`): circuit correctness, balance / nullifier / provenance rejection cases, Poseidon2 AIR correctness against Plonky3, and helper coverage.

## Demo-only assumptions

These live in the browser demo and the WASM helpers it calls. They are not part of the protocol design and they are not part of the proving stack truth.

- **Hardcoded demo identities** in `web/src/config/demo-fixtures.js`: `DEMO_SPENDING_KEY`, `DEMO_ATTESTATION_ISSUER`, `DEMO_ATTESTATION_EXPIRY`, `DEMO_ATTESTATION_SECRET`, `DEMO_USER_HANDLE`, `DEMO_DEFAULT_RECIPIENT`, `DEMO_DEFAULT_AMOUNT`. These exist so a visitor can produce a real proof without going through wallet onboarding.
- **Hardcoded starting balances** in `web/src/config/demo-fixtures.js`: `DEMO_INITIAL_BALANCES_UNITS` (USDC, USDT) and `DEMO_INITIAL_HUSH_BALANCE_UNITS`.
- **Demo HUSH spot price** (`HUSH_USD_PRICE` in `web/src/config/constants.js`): a fixed display rate used to render the balance card. The proving stack does not consume this number.
- **HUSH gas reserve** in the browser demo: HUSH is displayed and spent only as a sidecar fee asset. USDC and USDT are the supported payment assets in this repo.
- **Single boundary actor in `prove_demo_provenance_attestation`** (`src/wasm.rs`): builds a one-leaf Merkle tree to keep the demo path small. The circuit constraints are unchanged.
- **Demo wallet state** in `web/src/state/demo-state.js`: balances, transactions, activity, proof log are kept entirely in memory and reset on reload.

A reviewer can identify demo state in `web/src/config/demo-fixtures.js`, `web/src/state/demo-state.js`, and by anything prefixed `prove_demo_*` in `src/wasm.rs`.

## Not implemented in this repo

- Live validator network and consensus
- Live ledger, mempool, or block production
- Issuer integration and live boundary-actor signing infrastructure
- Production wallet SDK or note discovery
- Fee extraction pipeline at the network layer
- Validator incentive flow at the network layer
- Recursive proof aggregation
- Threshold-encrypted mempool
- Full revocation update pipeline and the future key-addressed sparse accumulator path needed for in-circuit payment non-revocation

## Known limitations

- WASM build uses Blake2s for the Merkle commitment backend instead of Poseidon252. Native build uses Poseidon252. Proof shape and validity are unaffected; this is a backend-only divergence to keep WASM dependencies minimal.
- `pow_bits=0` in the Stwo config because of an upstream bug in non-parallel Poseidon252 grinding. This affects DoS hardening rather than soundness.
- Fixed-width amount encoding caps payment amounts at the four-15-bit-limb range described in `docs/architecture.md`. This shape is intentional: the circuit cost does not vary with payment value within the supported range.
- Single boundary actor in the demo (see above). The constraint system supports a depth-20 Merkle tree of boundary actors; the demo just pre-populates one leaf.
- The payment circuit binds `accumulator_root` into the proof transcript, but v1 does not yet enforce in-circuit non-revocation. The time-window audit circuit is the path that currently consumes attestation-specific Merkle data directly.

## Next implementation priorities

These are tracked but not in this repo:

1. Validator-network proof submission path (lives in the alphanet repo)
2. Recursive proof aggregation across batched transactions
3. Boundary actor set management beyond the demo single-leaf tree
4. Threshold-encrypted mempool

For broader Hush Network architecture, scope, and current network state see the public Hush Network site rather than this repo.
