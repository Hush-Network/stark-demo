# Hush Network STARK Benchmark Report

Date: 2026-05-13
Host: local Windows workstation
Field: Mersenne31
Prover: Stwo
Merkle depth: 20
Iterations: 10

This report reflects the current public demo route: stablecoin payment with HUSH gas. The payment bundle row includes the payment proof plus the HUSH fee sidecar proof.

## Native, Single-Threaded

Command:

```powershell
cargo run --bin bench --release
```

| Circuit | Prove avg | Prove min | Prove max | Verify avg |
|---|---:|---:|---:|---:|
| Payment | 628.94ms | 562.06ms | 719.21ms | 73.96ms |
| Payment Bundle | 1280.11ms | 1239.38ms | 1343.61ms | 152.75ms |
| Provenance Attest. | 269.54ms | 265.77ms | 272.91ms | combined |
| Time-Window Audit | 277.51ms | 270.04ms | 286.93ms | combined |
| Accounting Accept | 3.19us | 0.10us | 29.40us | state |
| Epoch Accrual | 4.44us | 1.00us | 33.50us | state |
| Payout Generation | 0.19us | 0.00us | 1.20us | state |

## Native, Parallel

Command:

```powershell
cargo run --bin bench --release --features parallel
```

| Circuit | Prove avg | Prove min | Prove max | Verify avg |
|---|---:|---:|---:|---:|
| Payment | 341.39ms | 283.66ms | 400.11ms | 74.42ms |
| Payment Bundle | 770.31ms | 718.99ms | 818.67ms | 154.26ms |
| Provenance Attest. | 152.69ms | 144.40ms | 162.04ms | combined |
| Time-Window Audit | 140.38ms | 129.68ms | 157.26ms | combined |
| Accounting Accept | 2.45us | 0.10us | 22.70us | state |
| Epoch Accrual | 3.31us | 1.40us | 16.80us | state |
| Payout Generation | 0.21us | 0.00us | 1.00us | state |

## Notes

- Payment amount does not change the circuit shape within the supported amount range.
- The payment bundle measures the canonical demo path, not a comparison between fee routes.
- Accounting, epoch accrual, and payout generation are state-transition checks, not STARK proof generation.
