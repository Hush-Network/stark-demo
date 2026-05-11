import init, {
  dual_fee_quote_payment_with_schedule_json,
  dual_fee_submit_demo_payment_json,
  prove_demo_provenance_attestation,
  prove_time_window_audit,
} from '../../pkg/hush_demo_stark.js';

export async function initWasmRuntime() {
  await init();
}

export function createDemoAttestationProof(spendingKey, issuerId, expiry, secret) {
  return prove_demo_provenance_attestation(spendingKey, issuerId, expiry, secret);
}

export function quotePayment(paymentAssetId, feeAssetId, amountUnits, feeScheduleVersion) {
  return parseRuntimeResponse(
    dual_fee_quote_payment_with_schedule_json(
      paymentAssetId,
      feeAssetId,
      amountUnits,
      feeScheduleVersion,
    ),
  );
}

export function submitDemoPayment({
  paymentAssetId,
  feeAssetId,
  amountUnits,
  feeScheduleVersion,
  recipientOwner,
  paymentBalanceUnits,
  hushBalanceUnits,
  attestationExpiry,
}) {
  return parseRuntimeResponse(
    dual_fee_submit_demo_payment_json(
      paymentAssetId,
      feeAssetId,
      amountUnits,
      feeScheduleVersion,
      recipientOwner,
      paymentBalanceUnits,
      hushBalanceUnits,
      attestationExpiry,
    ),
  );
}

export function createAuditProof({
  startTs,
  endTs,
  amounts,
  timestamps,
  spendingKey,
  issuerId,
  expiry,
  secret,
}) {
  return prove_time_window_audit(
    startTs,
    endTs,
    amounts,
    timestamps,
    spendingKey,
    issuerId,
    expiry,
    secret,
  );
}

function parseRuntimeResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Invalid runtime response: ${error.message}` };
  }
}
