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
    payment_tx::{derive_sender_binding_tag, AssetId},
    poseidon2, poseidon2_air,
    prover_common::{pcs_config, ProverChannel, ProverMerkleChannel, ProverMerkleHasher},
    types::{HushFeeWitness, MERKLE_DEPTH},
};

const LOG_CONSTRAINT_EVAL_BLOWUP_FACTOR: u32 = 1;
const MERKLE_LEVEL_COLS: usize = 3 + poseidon2_air::HASH_INTERMEDIATE_COLS;
const AMT_BITS: usize = 21;
const AMT_RANGE_COLS: usize = 4 * AMT_BITS;
const NUM_HASHES: usize = 6;
const NUM_COLS: usize = 16
    + AMT_RANGE_COLS
    + NUM_HASHES * poseidon2_air::HASH_INTERMEDIATE_COLS
    + 2 * MERKLE_DEPTH * MERKLE_LEVEL_COLS;

fn constrain_merkle_path<E: EvalAtRow>(eval: &mut E, leaf: E::F, pub_root: E::F) {
    let mut current = leaf;
    for _ in 0..MERKLE_DEPTH {
        let sibling = eval.next_trace_mask();
        let direction = eval.next_trace_mask();
        let left = eval.next_trace_mask();

        eval.add_constraint(direction.clone() * (direction.clone() - E::F::one()));
        eval.add_constraint(
            left.clone() - current.clone() - direction * (sibling.clone() - current.clone()),
        );
        let right = current + sibling - left.clone();
        current = poseidon2_air::constrain_hash2(eval, left, right, poseidon2::DOMAIN_MERKLE);
    }
    eval.add_constraint(current - pub_root);
}

#[derive(Clone)]
pub struct HushFeeSidecarEval {
    pub log_size: u32,
}

impl FrameworkEval for HushFeeSidecarEval {
    fn log_size(&self) -> u32 {
        self.log_size
    }

    fn max_constraint_log_degree_bound(&self) -> u32 {
        self.log_size + LOG_CONSTRAINT_EVAL_BLOWUP_FACTOR
    }

    fn evaluate<E: EvalAtRow>(&self, mut eval: E) -> E {
        let sk = eval.next_trace_mask();
        let owner = eval.next_trace_mask();
        let in_amt_0 = eval.next_trace_mask();
        let in_rand_0 = eval.next_trace_mask();
        let in_amt_1 = eval.next_trace_mask();
        let in_rand_1 = eval.next_trace_mask();
        let in_cm_0 = eval.next_trace_mask();
        let in_cm_1 = eval.next_trace_mask();
        let null_0 = eval.next_trace_mask();
        let null_1 = eval.next_trace_mask();
        let change_amt = eval.next_trace_mask();
        let change_rand = eval.next_trace_mask();
        let fee_amount = eval.next_trace_mask();
        let change_cm = eval.next_trace_mask();
        let pub_note_root = eval.next_trace_mask();

        eval.add_constraint(
            in_amt_0.clone() + in_amt_1.clone() - change_amt.clone() - fee_amount.clone(),
        );

        let null_diff_inv = eval.next_trace_mask();
        eval.add_constraint((null_0.clone() - null_1.clone()) * null_diff_inv - E::F::one());

        let two = E::F::one() + E::F::one();
        for amt in [
            in_amt_0.clone(),
            in_amt_1.clone(),
            change_amt.clone(),
            fee_amount.clone(),
        ] {
            let mut recon = E::F::zero();
            let mut p2 = E::F::one();
            for _ in 0..AMT_BITS {
                let bit = eval.next_trace_mask();
                eval.add_constraint(bit.clone() * (bit.clone() - E::F::one()));
                recon += bit * p2.clone();
                p2 *= two.clone();
            }
            eval.add_constraint(recon - amt);
        }

        let owner_out = poseidon2_air::constrain_hash2(
            &mut eval,
            sk.clone(),
            E::F::zero(),
            poseidon2::DOMAIN_OWNER,
        );
        eval.add_constraint(owner - owner_out.clone());

        let null0_out = poseidon2_air::constrain_hash2(
            &mut eval,
            sk.clone(),
            in_cm_0.clone(),
            poseidon2::DOMAIN_NULLIFIER,
        );
        eval.add_constraint(null_0 - null0_out);

        let null1_out = poseidon2_air::constrain_hash2(
            &mut eval,
            sk,
            in_cm_1.clone(),
            poseidon2::DOMAIN_NULLIFIER,
        );
        eval.add_constraint(null_1 - null1_out);

        let hush_asset = E::F::from(M31::from(AssetId::Hush as u32));

        let cm0_out = poseidon2_air::constrain_hash_many_4(
            &mut eval,
            hush_asset.clone(),
            in_amt_0.clone(),
            owner_out.clone(),
            in_rand_0,
            poseidon2::DOMAIN_NOTE_CM,
        );
        eval.add_constraint(in_cm_0.clone() - cm0_out);

        let cm1_out = poseidon2_air::constrain_hash_many_4(
            &mut eval,
            hush_asset.clone(),
            in_amt_1.clone(),
            owner_out.clone(),
            in_rand_1,
            poseidon2::DOMAIN_NOTE_CM,
        );
        eval.add_constraint(in_cm_1.clone() - cm1_out);

        let change_cm_out = poseidon2_air::constrain_hash_many_4(
            &mut eval,
            hush_asset,
            change_amt.clone(),
            owner_out,
            change_rand,
            poseidon2::DOMAIN_NOTE_CM,
        );
        eval.add_constraint(change_cm - change_cm_out);

        constrain_merkle_path(&mut eval, in_cm_0, pub_note_root.clone());
        constrain_merkle_path(&mut eval, in_cm_1, pub_note_root);

        eval
    }
}

pub type HushFeeSidecarComponent = FrameworkComponent<HushFeeSidecarEval>;

pub struct HushFeePublicData {
    pub note_root: u32,
    pub tx_binding_hash: u32,
    pub sender_binding_tag: u32,
    pub fee_amount: u32,
    pub null_0: u32,
    pub null_1: u32,
    pub change_cm: u32,
}

impl HushFeePublicData {
    pub fn mix_into(&self, channel: &mut impl Channel) {
        channel.mix_u64(self.note_root as u64);
        channel.mix_u64(self.tx_binding_hash as u64);
        channel.mix_u64(self.sender_binding_tag as u64);
        channel.mix_u64(self.fee_amount as u64);
        channel.mix_u64(self.null_0 as u64);
        channel.mix_u64(self.null_1 as u64);
        channel.mix_u64(self.change_cm as u64);
    }
}

pub struct ProofResult {
    pub proof: stwo::core::proof::StarkProof<ProverMerkleHasher>,
    pub component: HushFeeSidecarComponent,
    pub public_data: HushFeePublicData,
    pub log_num_rows: u32,
}

fn gen_merkle_path_trace(leaf: M31, path: &[(u32, u32); MERKLE_DEPTH]) -> Vec<M31> {
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

fn gen_trace(
    witness: &HushFeeWitness,
    log_num_rows: u32,
) -> ColumnVec<CircleEvaluation<SimdBackend, M31, BitReversedOrder>> {
    let num_rows = 1 << log_num_rows;
    let mut cols: Vec<BaseColumn> = (0..NUM_COLS).map(|_| BaseColumn::zeros(num_rows)).collect();

    let sk = M31::from(witness.sk);
    let owner = poseidon2::derive_owner(sk);
    let hush_asset = M31::from(AssetId::Hush as u32);

    let in_amt_0 = M31::from(witness.in_amt_0);
    let in_rand_0 = M31::from(witness.in_rand_0);
    let in_amt_1 = M31::from(witness.in_amt_1);
    let in_rand_1 = M31::from(witness.in_rand_1);
    let in_cm_0 = poseidon2::note_commitment(hush_asset, in_amt_0, owner, in_rand_0);
    let in_cm_1 = poseidon2::note_commitment(hush_asset, in_amt_1, owner, in_rand_1);
    let null_0 = poseidon2::nullifier(sk, in_cm_0);
    let null_1 = poseidon2::nullifier(sk, in_cm_1);
    let change_amt = M31::from(witness.change_amt);
    let change_rand = M31::from(witness.change_rand);
    let fee_amount = M31::from(witness.fee_amount);
    let change_cm = poseidon2::note_commitment(hush_asset, change_amt, owner, change_rand);
    let pub_note_root = M31::from(witness.note_root);
    let null_diff = null_0 - null_1;
    let null_diff_inv =
        if null_diff == M31::from(0u32) { M31::from(0u32) } else { null_diff.inverse() };

    let owner_hash_cols =
        poseidon2_air::gen_hash2_intermediates(sk, M31::from(0u32), poseidon2::DOMAIN_OWNER);
    let null0_hash_cols =
        poseidon2_air::gen_hash2_intermediates(sk, in_cm_0, poseidon2::DOMAIN_NULLIFIER);
    let null1_hash_cols =
        poseidon2_air::gen_hash2_intermediates(sk, in_cm_1, poseidon2::DOMAIN_NULLIFIER);
    let cm0_hash_cols = poseidon2_air::gen_hash_many_4_intermediates(
        hush_asset,
        in_amt_0,
        owner,
        in_rand_0,
        poseidon2::DOMAIN_NOTE_CM,
    );
    let cm1_hash_cols = poseidon2_air::gen_hash_many_4_intermediates(
        hush_asset,
        in_amt_1,
        owner,
        in_rand_1,
        poseidon2::DOMAIN_NOTE_CM,
    );
    let change_hash_cols = poseidon2_air::gen_hash_many_4_intermediates(
        hush_asset,
        change_amt,
        owner,
        change_rand,
        poseidon2::DOMAIN_NOTE_CM,
    );
    let note_path_0_data = gen_merkle_path_trace(in_cm_0, &witness.note_path_0);
    let note_path_1_data = gen_merkle_path_trace(in_cm_1, &witness.note_path_1);

    for r in 0..num_rows {
        cols[0].set(r, sk);
        cols[1].set(r, owner);
        cols[2].set(r, in_amt_0);
        cols[3].set(r, in_rand_0);
        cols[4].set(r, in_amt_1);
        cols[5].set(r, in_rand_1);
        cols[6].set(r, in_cm_0);
        cols[7].set(r, in_cm_1);
        cols[8].set(r, null_0);
        cols[9].set(r, null_1);
        cols[10].set(r, change_amt);
        cols[11].set(r, change_rand);
        cols[12].set(r, fee_amount);
        cols[13].set(r, change_cm);
        cols[14].set(r, pub_note_root);
        cols[15].set(r, null_diff_inv);

        let amts = [witness.in_amt_0, witness.in_amt_1, witness.change_amt, witness.fee_amount];
        for (ai, &av) in amts.iter().enumerate() {
            for b in 0..AMT_BITS {
                cols[16 + ai * AMT_BITS + b].set(r, M31::from((av >> b) & 1));
            }
        }

        let hash_base = 16 + AMT_RANGE_COLS;
        let h = poseidon2_air::HASH_INTERMEDIATE_COLS;
        let all_hashes: [&Vec<M31>; NUM_HASHES] = [
            &owner_hash_cols,
            &null0_hash_cols,
            &null1_hash_cols,
            &cm0_hash_cols,
            &cm1_hash_cols,
            &change_hash_cols,
        ];
        for (hi, hash_cols) in all_hashes.iter().enumerate() {
            for i in 0..h {
                cols[hash_base + hi * h + i].set(r, hash_cols[i]);
            }
        }

        let merkle_base = hash_base + NUM_HASHES * h;
        let path_cols = MERKLE_DEPTH * MERKLE_LEVEL_COLS;
        let all_paths: [&Vec<M31>; 2] = [&note_path_0_data, &note_path_1_data];
        for (pi, path_data) in all_paths.iter().enumerate() {
            for i in 0..path_cols {
                cols[merkle_base + pi * path_cols + i].set(r, path_data[i]);
            }
        }
    }

    let domain = CanonicCoset::new(log_num_rows).circle_domain();
    cols.into_iter().map(|col| CircleEvaluation::new(domain, col)).collect()
}

fn validate_witness(witness: &HushFeeWitness) -> Result<HushFeePublicData, String> {
    let total_in = witness.in_amt_0 + witness.in_amt_1;
    let total_out = witness.change_amt + witness.fee_amount;
    if total_in != total_out {
        return Err(format!(
            "HUSH fee balance conservation failed: inputs {total_in} != change+fee {total_out}"
        ));
    }

    let expected_sender_binding_tag = derive_sender_binding_tag(witness.sk, witness.tx_binding_hash);
    if witness.sender_binding_tag != expected_sender_binding_tag {
        return Err(format!(
            "sender_binding_tag mismatch: witness {}, expected {}",
            witness.sender_binding_tag, expected_sender_binding_tag
        ));
    }

    let sk = M31::from(witness.sk);
    let owner = poseidon2::derive_owner(sk);
    let hush_asset = M31::from(AssetId::Hush as u32);
    let in_cm_0 = poseidon2::note_commitment(
        hush_asset,
        M31::from(witness.in_amt_0),
        owner,
        M31::from(witness.in_rand_0),
    );
    let in_cm_1 = poseidon2::note_commitment(
        hush_asset,
        M31::from(witness.in_amt_1),
        owner,
        M31::from(witness.in_rand_1),
    );

    let note_root = M31::from(witness.note_root);
    let note_path_0: Vec<(M31, u32)> =
        witness.note_path_0.iter().map(|&(s, d)| (M31::from(s), d)).collect();
    let note_path_1: Vec<(M31, u32)> =
        witness.note_path_1.iter().map(|&(s, d)| (M31::from(s), d)).collect();
    if !poseidon2::verify_merkle_path(in_cm_0, &note_path_0, note_root) {
        return Err("HUSH sidecar note Merkle path for input 0 is invalid".to_string());
    }
    if !poseidon2::verify_merkle_path(in_cm_1, &note_path_1, note_root) {
        return Err("HUSH sidecar note Merkle path for input 1 is invalid".to_string());
    }

    let null_0 = poseidon2::nullifier(sk, in_cm_0);
    let null_1 = poseidon2::nullifier(sk, in_cm_1);
    let change_cm = poseidon2::note_commitment(
        hush_asset,
        M31::from(witness.change_amt),
        owner,
        M31::from(witness.change_rand),
    );

    Ok(HushFeePublicData {
        note_root: witness.note_root,
        tx_binding_hash: witness.tx_binding_hash,
        sender_binding_tag: witness.sender_binding_tag,
        fee_amount: witness.fee_amount,
        null_0: null_0.0,
        null_1: null_1.0,
        change_cm: change_cm.0,
    })
}

pub fn prove_hush_fee(witness: &HushFeeWitness) -> Result<ProofResult, String> {
    let log_num_rows = LOG_N_LANES;
    let public_data = validate_witness(witness)?;
    let trace = gen_trace(witness, log_num_rows);

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

    let component = HushFeeSidecarComponent::new(
        &mut TraceLocationAllocator::default(),
        HushFeeSidecarEval { log_size: log_num_rows },
        QM31::zero(),
    );

    let proof = prove(&[&component], channel, commitment_scheme)
        .map_err(|e| format!("HUSH fee proof generation failed: {e:?}"))?;

    Ok(ProofResult { proof, component, public_data, log_num_rows })
}

pub fn verify_hush_fee(result: &ProofResult) -> Result<(), String> {
    let config = pcs_config();
    let channel = &mut ProverChannel::default();
    let commitment_scheme = &mut CommitmentSchemeVerifier::<ProverMerkleChannel>::new(config);
    let sizes = result.component.trace_log_degree_bounds();

    commitment_scheme.commit(result.proof.commitments[0], &sizes[0], channel);
    channel.mix_u64(result.log_num_rows as u64);
    result.public_data.mix_into(channel);
    commitment_scheme.commit(result.proof.commitments[1], &sizes[1], channel);

    verify(&[&result.component], channel, commitment_scheme, result.proof.clone())
        .map_err(|e| format!("HUSH fee verification failed: {e:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payment_fixtures::{
        invalid_hush_change_fixture, insufficient_hush_fee_coverage_fixture,
        valid_usdc_hush_fee_fixture, valid_usdt_hush_fee_fixture,
        wrong_sender_binding_tag_hush_fee_fixture, wrong_tx_binding_hash_hush_fee_fixture,
    };

    #[test]
    fn test_hush_fee_roundtrip_usdc_mode_b() {
        let fixture = valid_usdc_hush_fee_fixture();
        let witness = fixture.fee_sidecar_witness.expect("Mode B fixture should include sidecar");
        let result = prove_hush_fee(&witness).expect("Mode B HUSH sidecar proof should succeed");
        verify_hush_fee(&result).expect("Mode B HUSH sidecar verification should succeed");
        assert_eq!(result.public_data.tx_binding_hash, fixture.tx.tx_binding_hash);
        assert_eq!(result.public_data.sender_binding_tag, fixture.sender_binding_tag);
    }

    #[test]
    fn test_hush_fee_roundtrip_usdt_mode_b() {
        let fixture = valid_usdt_hush_fee_fixture();
        let witness = fixture.fee_sidecar_witness.expect("Mode B fixture should include sidecar");
        let result = prove_hush_fee(&witness).expect("Mode B HUSH sidecar proof should succeed");
        verify_hush_fee(&result).expect("Mode B HUSH sidecar verification should succeed");
    }

    #[test]
    fn test_insufficient_hush_fee_coverage_rejected() {
        let fixture = insufficient_hush_fee_coverage_fixture();
        let witness = fixture.fee_sidecar_witness.expect("invalid fixture should include sidecar");
        assert!(prove_hush_fee(&witness).is_err());
    }

    #[test]
    fn test_invalid_hush_change_rejected() {
        let fixture = invalid_hush_change_fixture();
        let witness = fixture.fee_sidecar_witness.expect("invalid fixture should include sidecar");
        assert!(prove_hush_fee(&witness).is_err());
    }

    #[test]
    fn test_wrong_sender_binding_tag_rejected() {
        let fixture = wrong_sender_binding_tag_hush_fee_fixture();
        let witness = fixture.fee_sidecar_witness.expect("invalid fixture should include sidecar");
        assert!(prove_hush_fee(&witness).is_err());
    }

    #[test]
    fn test_wrong_tx_binding_hash_rejected() {
        let fixture = wrong_tx_binding_hash_hush_fee_fixture();
        let witness = fixture.fee_sidecar_witness.expect("invalid fixture should include sidecar");
        assert!(prove_hush_fee(&witness).is_err());
    }
}
