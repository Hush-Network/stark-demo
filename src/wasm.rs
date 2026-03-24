//! WASM bindings for browser proving.

use wasm_bindgen::prelude::*;

use crate::{
    circuit,
    types::{PaymentWitness, MERKLE_DEPTH},
};

#[wasm_bindgen]
pub struct ProofOutput {
    success: bool,
    message: String,
    prove_time_ms: f64,
    verify_time_ms: f64,
    // Public outputs (populated on success)
    null_0: u32,
    null_1: u32,
    out_cm_0: u32,
    out_cm_1: u32,
    cred_null: u32,
}

#[wasm_bindgen]
impl ProofOutput {
    #[wasm_bindgen(getter)]
    pub fn success(&self) -> bool {
        self.success
    }

    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.message.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn prove_time_ms(&self) -> f64 {
        self.prove_time_ms
    }

    #[wasm_bindgen(getter)]
    pub fn verify_time_ms(&self) -> f64 {
        self.verify_time_ms
    }

    #[wasm_bindgen(getter)]
    pub fn null_0(&self) -> u32 {
        self.null_0
    }

    #[wasm_bindgen(getter)]
    pub fn null_1(&self) -> u32 {
        self.null_1
    }

    #[wasm_bindgen(getter)]
    pub fn out_cm_0(&self) -> u32 {
        self.out_cm_0
    }

    #[wasm_bindgen(getter)]
    pub fn out_cm_1(&self) -> u32 {
        self.out_cm_1
    }

    #[wasm_bindgen(getter)]
    pub fn cred_null(&self) -> u32 {
        self.cred_null
    }
}

fn parse_merkle_path(flat: &[u32]) -> [(u32, u32); MERKLE_DEPTH] {
    let mut path = [(0u32, 0u32); MERKLE_DEPTH];
    for i in 0..MERKLE_DEPTH {
        path[i] = (flat[2 * i], flat[2 * i + 1]);
    }
    path
}

fn error_output(message: String, prove_time_ms: f64) -> ProofOutput {
    ProofOutput {
        success: false,
        message,
        prove_time_ms,
        verify_time_ms: 0.0,
        null_0: 0,
        null_1: 0,
        out_cm_0: 0,
        out_cm_1: 0,
        cred_null: 0,
    }
}

#[wasm_bindgen]
pub fn prove_and_verify(
    epoch: u32,
    note_root: u32,
    cred_root: u32,
    sk: u32,
    in_asset: u32,
    in_amt_0: u32,
    in_rand_0: u32,
    in_amt_1: u32,
    in_rand_1: u32,
    out_amt_0: u32,
    out_owner_0: u32,
    out_rand_0: u32,
    out_amt_1: u32,
    out_rand_1: u32,
    cred_issuer: u32,
    cred_expiry: u32,
    cred_secret: u32,
    note_path_0_flat: &[u32],
    note_path_1_flat: &[u32],
    cred_path_flat: &[u32],
) -> ProofOutput {
    if note_path_0_flat.len() != 2 * MERKLE_DEPTH
        || note_path_1_flat.len() != 2 * MERKLE_DEPTH
        || cred_path_flat.len() != 2 * MERKLE_DEPTH
    {
        return error_output(
            format!("Merkle paths must each have {} elements", 2 * MERKLE_DEPTH),
            0.0,
        );
    }

    let witness = PaymentWitness {
        epoch,
        note_root,
        cred_root,
        sk,
        in_asset,
        in_amt_0,
        in_rand_0,
        in_amt_1,
        in_rand_1,
        out_amt_0,
        out_owner_0,
        out_rand_0,
        out_amt_1,
        out_rand_1,
        cred_issuer,
        cred_expiry,
        cred_secret,
        note_path_0: parse_merkle_path(note_path_0_flat),
        note_path_1: parse_merkle_path(note_path_1_flat),
        cred_path: parse_merkle_path(cred_path_flat),
    };

    // Prove
    let prove_start = js_sys::Date::now();
    let proof_result = match circuit::prove_payment(&witness) {
        Ok(r) => r,
        Err(e) => {
            return error_output(e, js_sys::Date::now() - prove_start);
        }
    };
    let prove_time = js_sys::Date::now() - prove_start;

    let pd = &proof_result.public_data;
    let null_0 = pd.null_0;
    let null_1 = pd.null_1;
    let out_cm_0 = pd.out_cm_0;
    let out_cm_1 = pd.out_cm_1;
    let cred_null = pd.cred_null;

    // Verify
    let verify_start = js_sys::Date::now();
    match circuit::verify_payment(&proof_result) {
        Ok(()) => ProofOutput {
            success: true,
            message: "STARK proof verified successfully".to_string(),
            prove_time_ms: prove_time,
            verify_time_ms: js_sys::Date::now() - verify_start,
            null_0,
            null_1,
            out_cm_0,
            out_cm_1,
            cred_null,
        },
        Err(e) => ProofOutput {
            success: false,
            message: format!("Proof generated but verification failed: {e}"),
            prove_time_ms: prove_time,
            verify_time_ms: js_sys::Date::now() - verify_start,
            null_0: 0,
            null_1: 0,
            out_cm_0: 0,
            out_cm_1: 0,
            cred_null: 0,
        },
    }
}

#[wasm_bindgen]
pub fn compute_credential_root(sk: u32, issuer: u32, expiry: u32, secret: u32) -> u32 {
    use stwo::core::fields::m31::M31;

    use crate::poseidon2;

    let owner = poseidon2::derive_owner(M31::from(sk));
    let cred_cm = poseidon2::credential_commitment(
        M31::from(issuer),
        owner,
        M31::from(expiry),
        M31::from(secret),
    );
    let mut tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
    tree.set_leaf(0, cred_cm);
    tree.root().0
}

#[wasm_bindgen]
pub fn compute_note_root(
    sk: u32,
    in_asset: u32,
    in_amt_0: u32,
    in_rand_0: u32,
    in_amt_1: u32,
    in_rand_1: u32,
) -> u32 {
    use stwo::core::fields::m31::M31;

    use crate::poseidon2;

    let owner = poseidon2::derive_owner(M31::from(sk));
    let cm0 = poseidon2::note_commitment(
        M31::from(in_asset),
        M31::from(in_amt_0),
        owner,
        M31::from(in_rand_0),
    );
    let cm1 = poseidon2::note_commitment(
        M31::from(in_asset),
        M31::from(in_amt_1),
        owner,
        M31::from(in_rand_1),
    );
    let mut tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
    tree.set_leaf(0, cm0);
    tree.set_leaf(1, cm1);
    tree.root().0
}

#[wasm_bindgen]
pub fn compute_merkle_path(leaf_index: usize, leaf_values_flat: &[u32]) -> Vec<u32> {
    use stwo::core::fields::m31::M31;

    use crate::poseidon2;

    let leaves: Vec<M31> = leaf_values_flat.iter().map(|&v| M31::from(v)).collect();
    let tree = poseidon2::build_merkle_tree(&leaves);
    let path = poseidon2::merkle_path(&tree, leaf_index);
    let mut flat = Vec::with_capacity(2 * MERKLE_DEPTH);
    for (sibling, dir) in &path {
        flat.push(sibling.0);
        flat.push(*dir);
    }
    flat
}
