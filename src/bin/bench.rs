use std::time::Instant;

use hush_demo_stark::{
    circuit, credential_issuance, poseidon2, time_window,
    types::{PaymentWitness, MERKLE_DEPTH},
};
use stwo::core::fields::m31::M31;

const ITERATIONS: usize = 10;

fn stats(times: &[f64]) -> (f64, f64, f64) {
    let min = times.iter().cloned().fold(f64::MAX, f64::min);
    let avg = times.iter().sum::<f64>() / times.len() as f64;
    let max = times.iter().cloned().fold(0.0f64, f64::max);
    (min, avg, max)
}

fn bench_payment() -> ((f64, f64, f64), (f64, f64, f64)) {
    let sk = M31::from(12345u32);
    let owner = poseidon2::derive_owner(sk);
    let in_asset = M31::from(1u32);

    let in_cm_0 =
        poseidon2::note_commitment(in_asset, M31::from(7000u32), owner, M31::from(111u32));
    let in_cm_1 =
        poseidon2::note_commitment(in_asset, M31::from(3000u32), owner, M31::from(222u32));

    let mut note_tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
    note_tree.set_leaf(0, in_cm_0);
    note_tree.set_leaf(1, in_cm_1);
    let note_root = note_tree.root();
    let note_path_0_vec = note_tree.path(0);
    let note_path_1_vec = note_tree.path(1);

    let cred_cm = poseidon2::credential_commitment(
        M31::from(1u32),
        owner,
        M31::from(2000u32),
        M31::from(777u32),
    );
    let mut cred_tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
    cred_tree.set_leaf(0, cred_cm);
    let cred_root = cred_tree.root();
    let cred_path_vec = cred_tree.path(0);

    let mut note_path_0 = [(0u32, 0u32); MERKLE_DEPTH];
    let mut note_path_1 = [(0u32, 0u32); MERKLE_DEPTH];
    let mut cred_path = [(0u32, 0u32); MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        note_path_0[i] = (note_path_0_vec[i].0 .0, note_path_0_vec[i].1);
        note_path_1[i] = (note_path_1_vec[i].0 .0, note_path_1_vec[i].1);
        cred_path[i] = (cred_path_vec[i].0 .0, cred_path_vec[i].1);
    }

    let witness = PaymentWitness {
        epoch: 1000,
        note_root: note_root.0,
        cred_root: cred_root.0,
        sk: 12345,
        in_asset: 1,
        in_amt_0: 7000,
        in_rand_0: 111,
        in_amt_1: 3000,
        in_rand_1: 222,
        out_amt_0: 8000,
        out_owner_0: 99999,
        out_rand_0: 333,
        out_amt_1: 2000,
        out_rand_1: 444,
        cred_issuer: 1,
        cred_expiry: 2000,
        cred_secret: 777,
        note_path_0,
        note_path_1,
        cred_path,
    };

    let mut prove_times = Vec::new();
    let mut verify_times = Vec::new();

    for _ in 0..ITERATIONS {
        let start = Instant::now();
        let result = circuit::prove_payment(&witness).unwrap();
        prove_times.push(start.elapsed().as_micros() as f64 / 1000.0);

        let start = Instant::now();
        circuit::verify_payment(&result).unwrap();
        verify_times.push(start.elapsed().as_micros() as f64 / 1000.0);
    }

    (stats(&prove_times), stats(&verify_times))
}

fn bench_credential_issuance() -> (f64, f64, f64) {
    let issuer_key = M31::from(42u32);
    let issuer_id = poseidon2::derive_issuer_id(issuer_key);
    let subject = poseidon2::derive_owner(M31::from(12345u32));
    let cm =
        poseidon2::credential_commitment(issuer_id, subject, M31::from(2000u32), M31::from(777u32));

    let mut issuer_tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
    issuer_tree.set_leaf(0, issuer_id);
    let path_vec = issuer_tree.path(0);
    let mut issuer_path = [(0u32, 0u32); MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        issuer_path[i] = (path_vec[i].0 .0, path_vec[i].1);
    }

    let witness = credential_issuance::IssuanceWitness {
        issuer_root: issuer_tree.root().0,
        credential_commitment: cm.0,
        issuer_key: 42,
        subject: subject.0,
        expiry: 2000,
        secret: 777,
        issuer_path,
    };

    let mut times = Vec::new();
    for _ in 0..ITERATIONS {
        let start = Instant::now();
        credential_issuance::prove_issuance(&witness).unwrap();
        times.push(start.elapsed().as_micros() as f64 / 1000.0);
    }
    stats(&times)
}

fn bench_time_window() -> (f64, f64, f64) {
    let sk = M31::from(12345u32);
    let owner = poseidon2::derive_owner(sk);
    let cred_cm = poseidon2::credential_commitment(
        M31::from(1u32),
        owner,
        M31::from(2000u32),
        M31::from(777u32),
    );

    let mut cred_tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
    cred_tree.set_leaf(0, cred_cm);
    let path_vec = cred_tree.path(0);
    let mut cred_path = [(0u32, 0u32); MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        cred_path[i] = (path_vec[i].0 .0, path_vec[i].1);
    }

    let mut amounts = [0u32; 16];
    let mut timestamps = [0u32; 16];
    amounts[0] = 50000;
    timestamps[0] = 100;
    amounts[1] = 30000;
    timestamps[1] = 200;
    amounts[2] = 20000;
    timestamps[2] = 300;
    amounts[3] = 10000;
    timestamps[3] = 400;

    let witness = time_window::TimeWindowWitness {
        window_start: 50,
        window_end: 500,
        claimed_total: 110000,
        cred_root: cred_tree.root().0,
        epoch: 1000,
        tx_amounts: amounts,
        tx_timestamps: timestamps,
        tx_count: 4,
        sk: 12345,
        cred_issuer: 1,
        cred_expiry: 2000,
        cred_secret: 777,
        cred_path,
    };

    let mut times = Vec::new();
    for _ in 0..ITERATIONS {
        let start = Instant::now();
        time_window::prove_time_window(&witness).unwrap();
        times.push(start.elapsed().as_micros() as f64 / 1000.0);
    }
    stats(&times)
}

fn main() {
    println!("\nHush Network STARK Benchmark Suite");
    println!(
        "Field: Mersenne31 | Prover: Stwo | Depth: {MERKLE_DEPTH} | Iterations: {ITERATIONS}\n"
    );

    let (prove, verify) = bench_payment();
    let issuance = bench_credential_issuance();
    let tw = bench_time_window();

    println!("| Circuit             | Prove (avg)  | Prove (min)  | Prove (max)  | Verify (avg) |");
    println!("|---------------------|-------------|-------------|-------------|-------------|");
    println!(
        "| {:<19} | {:>9.2}ms | {:>9.2}ms | {:>9.2}ms | {:>9.2}ms |",
        "Payment", prove.1, prove.0, prove.2, verify.1
    );
    println!(
        "| {:<19} | {:>9.2}ms | {:>9.2}ms | {:>9.2}ms | {:>9}  |",
        "Credential Issuance", issuance.1, issuance.0, issuance.2, "(combined)"
    );
    println!(
        "| {:<19} | {:>9.2}ms | {:>9.2}ms | {:>9.2}ms | {:>9}  |",
        "Time-Window Audit", tw.1, tw.0, tw.2, "(combined)"
    );
    println!();
}
