export function buildReceiptPayload({
  tx,
  amtScale,
  selectedFields,
  senderLabel,
  senderBalance,
}) {
  const receipt = {
    version: 2,
    receipt_id: tx.receipt.receipt_id,
    amt_scale: amtScale,
    proof: tx.receipt.proof,
    binding: tx.receipt.binding,
    fee: { amount: tx.feeAmount, asset: tx.feeAsset },
  };

  if (selectedFields.amount) {
    receipt.amount = tx.amount;
    receipt.amount_units = tx.receipt.amount_units;
  }
  if (selectedFields.timestamp) receipt.timestamp = tx.receipt.timestamp;
  if (selectedFields.recipient) receipt.recipient = tx.recipient;
  if (selectedFields.asset) receipt.asset = tx.asset;
  if (selectedFields.txid) receipt.public_tx_id = tx.id;
  if (selectedFields.sender) receipt.sender = senderLabel;
  if (selectedFields.balance) receipt.sender_balance = senderBalance;

  return receipt;
}

export function buildAuditPayload({ result, activeAsset, amtScale }) {
  return {
    type: 'hush-audit-proof',
    version: 2,
    asset: activeAsset,
    amt_scale: amtScale,
    prove_ms: result.proveMs,
    verify_ms: result.verifyMs,
    window: {
      start_date: result.startDate,
      end_date: result.endDate,
    },
    total_volume: result.totalVolume,
    total_volume_units: result.claimed_total,
    tx_count: result.txs.length,
    disclosed: result.selected,
    proof: {
      proof_bytes: result.proof_bytes,
      window_start: result.window_start,
      window_end: result.window_end,
      claimed_total: result.claimed_total,
      attestation_root: result.attestation_root,
      attestation_nullifier: result.attestation_nullifier,
      epoch: result.epoch,
      log_num_rows: result.log_num_rows,
    },
  };
}
