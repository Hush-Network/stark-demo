//! Credential issuance circuit.

use num_traits::{One, Zero};
use stwo::{
    core::{
        air::Component,
        channel::Channel,
        fields::{m31::M31, qm31::QM31},
        pcs::CommitmentSchemeVerifier,
        poly::circle::CanonicCoset,
        verifier::verify,
        ColumnVec,
    },
    prover::{
        backend::{
            simd::{column::BaseColumn, m31::LOG_N_LANES, SimdBackend},
            Column,
        },
        poly::{
            circle::{CircleEvaluation, PolyOps},
            BitReversedOrder,
        },
        prove, CommitmentSchemeProver,
    },
};
use stwo_constraint_framework::{
    EvalAtRow, FrameworkComponent, FrameworkEval, TraceLocationAllocator,
};

use crate::{
    poseidon2, poseidon2_air,
    prover_common::{pcs_config, ProverChannel, ProverMerkleChannel},
    types::MERKLE_DEPTH,
};

const LOG_CONSTRAINT_EVAL_BLOWUP_FACTOR: u32 = 1;

const MERKLE_LEVEL_COLS: usize = 3 + poseidon2_air::HASH_INTERMEDIATE_COLS;
const NUM_COLS: usize = 6 + 636 + 636 + MERKLE_DEPTH * MERKLE_LEVEL_COLS;

#[derive(Clone, Debug)]
pub struct IssuanceWitness {
    pub issuer_root: u32,
    pub credential_commitment: u32,
    pub issuer_key: u32,
    pub subject: u32,
    pub expiry: u32,
    pub secret: u32,
    pub issuer_path: [(u32, u32); MERKLE_DEPTH],
}

#[derive(Clone)]
pub struct IssuanceEval {
    pub log_size: u32,
}

impl FrameworkEval for IssuanceEval {
    fn log_size(&self) -> u32 {
        self.log_size
    }

    fn max_constraint_log_degree_bound(&self) -> u32 {
        self.log_size + LOG_CONSTRAINT_EVAL_BLOWUP_FACTOR
    }

    fn evaluate<E: EvalAtRow>(&self, mut eval: E) -> E {
        let issuer_key = eval.next_trace_mask(); // 0
        let subject = eval.next_trace_mask(); // 1
        let expiry = eval.next_trace_mask(); // 2
        let secret = eval.next_trace_mask(); // 3
        let pub_issuer_root = eval.next_trace_mask(); // 4
        let pub_cred_cm = eval.next_trace_mask(); // 5

        let issuer_id = poseidon2_air::constrain_hash2(
            &mut eval,
            issuer_key,
            E::F::zero(),
            poseidon2::DOMAIN_ISSUER_ID,
        );

        let cm_out = poseidon2_air::constrain_hash_many_4(
            &mut eval,
            issuer_id.clone(),
            subject,
            expiry,
            secret,
            poseidon2::DOMAIN_CRED_CM,
        );
        eval.add_constraint(cm_out - pub_cred_cm);

        let mut current = issuer_id;
        for _ in 0..MERKLE_DEPTH {
            let sibling = eval.next_trace_mask();
            let direction = eval.next_trace_mask();
            let left = eval.next_trace_mask();

            eval.add_constraint(direction.clone() * (direction.clone() - E::F::one()));
            eval.add_constraint(
                left.clone() - current.clone() - direction * (sibling.clone() - current.clone()),
            );
            let right = current + sibling - left.clone();
            current =
                poseidon2_air::constrain_hash2(&mut eval, left, right, poseidon2::DOMAIN_MERKLE);
        }
        eval.add_constraint(current - pub_issuer_root);

        eval
    }
}

pub type IssuanceComponent = FrameworkComponent<IssuanceEval>;

pub struct IssuancePublicData {
    pub issuer_root: u32,
    pub credential_commitment: u32,
}

impl IssuancePublicData {
    pub fn mix_into(&self, channel: &mut impl Channel) {
        channel.mix_u64(self.issuer_root as u64);
        channel.mix_u64(self.credential_commitment as u64);
    }
}

pub fn prove_issuance(witness: &IssuanceWitness) -> Result<(), String> {
    let log_num_rows = LOG_N_LANES;
    let num_rows = 1 << log_num_rows;

    #[cfg(debug_assertions)]
    eprintln!("[issuance] {NUM_COLS} cols, log_rows={log_num_rows}");

    let issuer_key = M31::from(witness.issuer_key);
    let subject = M31::from(witness.subject);
    let expiry = M31::from(witness.expiry);
    let secret = M31::from(witness.secret);

    let issuer_id = poseidon2::derive_issuer_id(issuer_key);
    let computed_cm = poseidon2::credential_commitment(issuer_id, subject, expiry, secret);

    if computed_cm != M31::from(witness.credential_commitment) {
        return Err("Credential commitment does not match expected value".to_string());
    }

    // Verify issuer Merkle path
    let issuer_root = M31::from(witness.issuer_root);
    let issuer_path: Vec<(M31, u32)> =
        witness.issuer_path.iter().map(|&(s, d)| (M31::from(s), d)).collect();
    if !poseidon2::verify_merkle_path(issuer_id, &issuer_path, issuer_root) {
        return Err("Issuer is not in the authorized issuer set".to_string());
    }

    // Hash intermediates
    let issuer_id_cols = poseidon2_air::gen_hash2_intermediates(
        issuer_key,
        M31::from(0u32),
        poseidon2::DOMAIN_ISSUER_ID,
    );
    let cm_cols = poseidon2_air::gen_hash_many_4_intermediates(
        issuer_id,
        subject,
        expiry,
        secret,
        poseidon2::DOMAIN_CRED_CM,
    );

    // Merkle path intermediates
    let merkle_data = gen_issuer_merkle_trace(issuer_id, &witness.issuer_path);

    let mut cols: Vec<BaseColumn> = (0..NUM_COLS).map(|_| BaseColumn::zeros(num_rows)).collect();

    for r in 0..num_rows {
        cols[0].set(r, issuer_key);
        cols[1].set(r, subject);
        cols[2].set(r, expiry);
        cols[3].set(r, secret);
        cols[4].set(r, M31::from(witness.issuer_root));
        cols[5].set(r, M31::from(witness.credential_commitment));
        for i in 0..636 {
            cols[6 + i].set(r, issuer_id_cols[i]);
        }
        for i in 0..636 {
            cols[642 + i].set(r, cm_cols[i]);
        }
        let merkle_base = 1278;
        for i in 0..merkle_data.len() {
            cols[merkle_base + i].set(r, merkle_data[i]);
        }
    }

    let domain = CanonicCoset::new(log_num_rows).circle_domain();
    let trace: ColumnVec<CircleEvaluation<SimdBackend, M31, BitReversedOrder>> =
        cols.into_iter().map(|col| CircleEvaluation::new(domain, col)).collect();

    let public_data = IssuancePublicData {
        issuer_root: witness.issuer_root,
        credential_commitment: witness.credential_commitment,
    };

    let config = pcs_config();
    let twiddles = SimdBackend::precompute_twiddles(
        CanonicCoset::new(
            log_num_rows + LOG_CONSTRAINT_EVAL_BLOWUP_FACTOR + config.fri_config.log_blowup_factor,
        )
        .circle_domain()
        .half_coset,
    );

    let channel = &mut ProverChannel::default();
    let mut commitment_scheme =
        CommitmentSchemeProver::<SimdBackend, ProverMerkleChannel>::new(config, &twiddles);

    let mut tree_builder = commitment_scheme.tree_builder();
    tree_builder.extend_evals(vec![]);
    tree_builder.commit(channel);

    channel.mix_u64(log_num_rows as u64);
    public_data.mix_into(channel);

    let mut tree_builder = commitment_scheme.tree_builder();
    tree_builder.extend_evals(trace);
    tree_builder.commit(channel);

    let component = IssuanceComponent::new(
        &mut TraceLocationAllocator::default(),
        IssuanceEval { log_size: log_num_rows },
        QM31::zero(),
    );

    let proof = prove(&[&component], channel, commitment_scheme)
        .map_err(|e| format!("Issuance proof generation failed: {e:?}"))?;

    // Verify inline
    let channel = &mut ProverChannel::default();
    let commitment_scheme = &mut CommitmentSchemeVerifier::<ProverMerkleChannel>::new(config);
    let sizes = component.trace_log_degree_bounds();

    commitment_scheme.commit(proof.commitments[0], &sizes[0], channel);
    channel.mix_u64(log_num_rows as u64);
    public_data.mix_into(channel);
    commitment_scheme.commit(proof.commitments[1], &sizes[1], channel);

    verify(&[&component], channel, commitment_scheme, proof)
        .map_err(|e| format!("Issuance verification failed: {e:?}"))
}

fn gen_issuer_merkle_trace(leaf: M31, path: &[(u32, u32); MERKLE_DEPTH]) -> Vec<M31> {
    let mut result = Vec::with_capacity(MERKLE_DEPTH * MERKLE_LEVEL_COLS);
    let mut current = leaf;

    for &(sibling_val, direction_val) in path.iter() {
        let sibling = M31::from(sibling_val);
        let direction = M31::from(direction_val);

        let (left, right) =
            if direction_val == 0 { (current, sibling) } else { (sibling, current) };

        result.push(sibling);
        result.push(direction);
        result.push(left);

        let hash_cols =
            poseidon2_air::gen_hash2_intermediates(left, right, poseidon2::DOMAIN_MERKLE);
        result.extend_from_slice(&hash_cols);

        current = poseidon2::merkle_hash(left, right);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_issuance_roundtrip() {
        let issuer_key = M31::from(42u32);
        let issuer_id = poseidon2::derive_issuer_id(issuer_key);
        let subject = poseidon2::derive_owner(M31::from(12345u32));
        let cm = poseidon2::credential_commitment(
            issuer_id,
            subject,
            M31::from(2000u32),
            M31::from(777u32),
        );

        let mut issuer_tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
        issuer_tree.set_leaf(0, issuer_id);
        let issuer_root = issuer_tree.root();
        let path_vec = issuer_tree.path(0);

        let mut issuer_path = [(0u32, 0u32); MERKLE_DEPTH];
        for i in 0..MERKLE_DEPTH {
            issuer_path[i] = (path_vec[i].0 .0, path_vec[i].1);
        }

        let witness = IssuanceWitness {
            issuer_root: issuer_root.0,
            credential_commitment: cm.0,
            issuer_key: 42,
            subject: subject.0,
            expiry: 2000,
            secret: 777,
            issuer_path,
        };

        prove_issuance(&witness).expect("Issuance should succeed");
    }

    #[test]
    fn test_wrong_issuer_key() {
        let issuer_key = M31::from(42u32);
        let issuer_id = poseidon2::derive_issuer_id(issuer_key);
        let subject = poseidon2::derive_owner(M31::from(12345u32));
        let cm = poseidon2::credential_commitment(
            issuer_id,
            subject,
            M31::from(2000u32),
            M31::from(777u32),
        );

        // Empty tree — issuer not present
        let empty_tree = poseidon2::SparseMerkleTree::new(MERKLE_DEPTH);
        let bad_root = empty_tree.root();
        let path_vec = empty_tree.path(0);

        let mut issuer_path = [(0u32, 0u32); MERKLE_DEPTH];
        for i in 0..MERKLE_DEPTH {
            issuer_path[i] = (path_vec[i].0 .0, path_vec[i].1);
        }

        let witness = IssuanceWitness {
            issuer_root: bad_root.0,
            credential_commitment: cm.0,
            issuer_key: 42,
            subject: subject.0,
            expiry: 2000,
            secret: 777,
            issuer_path,
        };

        match prove_issuance(&witness) {
            Err(e) => assert!(e.contains("authorized issuer set"), "Got: {e}"),
            Ok(_) => panic!("Should have rejected unauthorized issuer"),
        }
    }
}
