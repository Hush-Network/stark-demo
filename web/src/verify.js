import init, { verify_serialized_proof, verify_audit_proof, recompute_tx_binding_hash_json } from '../pkg/hush_demo_stark.js';
import { esc, fmtHash4, hexToU32Array } from './lib/formatters.js';

const input = document.getElementById('receipt-input');
const btnVerify = document.getElementById('btn-verify');
const resultEl = document.getElementById('result');
const banner = document.getElementById('result-banner');
const body = document.getElementById('result-body');

let wasmReady = false;

init().then(() => {
  wasmReady = true;
}).catch((e) => {
  console.error('WASM init failed:', e);
});

btnVerify.addEventListener('click', verify);

const stored = localStorage.getItem('hush-receipt');
if (stored) {
  input.value = stored;
  localStorage.removeItem('hush-receipt');
  const tryVerify = () => {
    if (wasmReady) {
      verify();
    } else {
      setTimeout(tryVerify, 100);
    }
  };
  tryVerify();
}

const ASSET_NAMES = { 1: 'USDC', 2: 'USDT', 3: 'HUSH' };

function fmtBoundAmount(protocolUnits, scale) {
  if (!scale || scale <= 0) return esc(String(protocolUnits)) + ' protocol units';
  return '$' + (protocolUnits / scale).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

async function verify() {
  resultEl.classList.remove('show');

  let receipt;
  try {
    receipt = JSON.parse(input.value.trim());
  } catch {
    showError('Invalid JSON. Paste a valid receipt.');
    return;
  }

  // Route: audit proof or payment receipt?
  if ((receipt.type === 'hush-audit-key' || receipt.type === 'hush-audit-proof') && receipt.proof && receipt.proof.proof_bytes) {
    return verifyAuditProof(receipt);
  }

  // Accept both old tx_id and new receipt_id
  const receiptId = receipt.receipt_id || receipt.tx_id;
  if (!receipt.version || !receiptId || !receipt.proof || typeof receipt.proof !== 'object') {
    showError('Missing required fields (version, receipt_id/tx_id, proof).');
    return;
  }

  if (!receipt.proof.null_0 || !receipt.proof.out_cm_0) {
    showError('Receipt is missing the proof outputs needed for verification.');
    return;
  }

  // --- Check 1: Binding hash recomputation ---
  let bindingVerified = false;
  let bindingError = null;
  if (receipt.binding && wasmReady) {
    try {
      const result = JSON.parse(recompute_tx_binding_hash_json(JSON.stringify(receipt.binding)));
      if (result.error) {
        bindingError = result.error;
      } else {
        // result.hash is [u32; 4] from WASM; receipt.proof.tx_binding_hash is a hex string.
        // Normalize both to lowercase hex without 0x prefix for comparison.
        const computedHex = (Array.isArray(result.hash) ? fmtHash4(result.hash) : String(result.hash))
          .replace(/^0x/i, '').toLowerCase();
        const claimedHex = String(receipt.proof.tx_binding_hash || '').replace(/^0x/i, '').toLowerCase();
        if (computedHex !== claimedHex) {
          bindingError = `Binding hash mismatch: computed 0x${computedHex}, receipt claims ${receipt.proof.tx_binding_hash}`;
        } else {
          bindingVerified = true;
        }
      }
    } catch (e) {
      bindingError = 'Binding recomputation error: ' + e.message;
    }
  }

  if (bindingError) {
    banner.className = 'result-banner invalid';
    banner.textContent = '\u2717 Verification failed: ' + bindingError;
    body.innerHTML = '';
    resultEl.classList.add('show');
    return;
  }

  // --- Check 2: STARK proof verification ---
  let starkVerified = false;
  let starkError = null;
  const hasProofBytes = !!receipt.proof.proof_bytes;
  if (hasProofBytes && wasmReady) {
    try {
      const null_0 = hexToU32Array(receipt.proof.null_0);
      const null_1 = hexToU32Array(receipt.proof.null_1);
      const out_cm_0 = hexToU32Array(receipt.proof.out_cm_0);
      const out_cm_1 = hexToU32Array(receipt.proof.out_cm_1);
      const note_root = hexToU32Array(receipt.proof.note_root);
      const accumulator_root = hexToU32Array(receipt.proof.accumulator_root);
      const epoch = receipt.proof.epoch || 0;
      const tx_binding_hash = hexToU32Array(receipt.proof.tx_binding_hash);
      const sender_binding_tag = hexToU32Array(receipt.proof.sender_binding_tag);
      const logNumRows = receipt.proof.log_num_rows || 4; // default to LOG_N_LANES for old receipts
      const result = verify_serialized_proof(
        receipt.proof.proof_bytes,
        note_root, accumulator_root, epoch,
        null_0, null_1, out_cm_0, out_cm_1,
        tx_binding_hash, sender_binding_tag,
        logNumRows
      );
      if (result === 'ok') {
        starkVerified = true;
      } else {
        starkError = result;
      }
    } catch (e) {
      starkError = e.message;
    }
  }

  if (hasProofBytes && !starkVerified) {
    banner.className = 'result-banner invalid';
    banner.textContent = '\u2717 STARK verification failed. ' + (starkError || 'Unknown error.');
    body.innerHTML = '';
    resultEl.classList.add('show');
    return;
  }

  // --- Check 3: Display cross-check (soft, logged but not blocking) ---
  const crossCheckNotes = [];
  if (bindingVerified && receipt.amount != null && receipt.amt_scale) {
    if (receipt.amt_scale !== 10000) {
      crossCheckNotes.push(`Unexpected amount scale (${receipt.amt_scale}). Demo receipts are expected to use 10000.`);
    }
    const expectedUnits = Number.isInteger(receipt.amount_units)
      ? receipt.amount_units
      : Math.round(receipt.amount * receipt.amt_scale);
    if (expectedUnits !== receipt.binding.recipient_amount) {
      crossCheckNotes.push(`Display amount (${receipt.amount}) does not match binding (${receipt.binding.recipient_amount} protocol units at scale ${receipt.amt_scale})`);
    }
  }

  // --- Set banner ---
  if (bindingVerified && starkVerified) {
    banner.className = 'result-banner valid';
    banner.textContent = '\u2713 Proof valid. Bound fields verified.';
  } else if (starkVerified && !receipt.binding) {
    banner.className = 'result-banner partial';
    banner.textContent = '\u2713 Proof bytes verified. Receipt fields are not independently bound.';
  } else if (!hasProofBytes) {
    banner.className = 'result-banner partial';
    banner.textContent = 'Receipt parsed. No proof bytes attached.';
  }

  // --- Build result display ---
  const hidden = 'not disclosed';
  const scale = receipt.amt_scale || 0;
  let html = '';

  // Verification status row
  if (starkVerified) {
    html += `<div class="result-row result-row-highlight">
      <span class="result-label">STARK proof</span>
      <span class="result-value result-verified">Verified (${esc(String(receipt.proof.verify_ms || '?'))}ms)</span>
    </div>`;
  }
  if (bindingVerified) {
    html += `<div class="result-row result-row-highlight">
      <span class="result-label">Binding hash</span>
      <span class="result-value result-verified">Recomputed and matched</span>
    </div>`;
  }

  // Cross-check warnings
  for (const note of crossCheckNotes) {
    html += `<div class="result-row" style="color:#fbbf24">
      <span class="result-label">Warning</span>
      <span class="result-value">${esc(note)}</span>
    </div>`;
  }

  // --- Section: Cryptographically bound fields ---
  if (bindingVerified) {
    html += '<div class="result-section">Cryptographically Bound (verified against proof)</div>';
    html += row('Recipient amount', fmtBoundAmount(receipt.binding.recipient_amount, scale));
    html += row('Payment asset', esc(ASSET_NAMES[receipt.binding.payment_asset] || String(receipt.binding.payment_asset)));
    html += row('Fee amount', fmtBoundAmount(receipt.binding.fee_amount, scale));
    html += row('Fee asset', esc(ASSET_NAMES[receipt.binding.fee_asset] || String(receipt.binding.fee_asset)));
    html += row('Change amount', fmtBoundAmount(receipt.binding.sender_change_amount, scale));
  }

  // --- Section: Disclosed metadata (not verified) ---
  html += '<div class="result-section">Disclosed Metadata (not cryptographically verified)</div>';
  html += row('Receipt ID', esc(receiptId));
  html += row('Recipient', esc(receipt.recipient) || hidden);
  if (receipt.amount != null) {
    html += row('Display amount', esc(receipt.amount.toLocaleString()) + ' ' + esc(receipt.asset || ''));
  }
  html += row('Timestamp', esc(receipt.timestamp) || hidden);
  html += row('Sender', esc(receipt.sender) || hidden);
  if (receipt.sender_balance != null) {
    html += row('Sender balance', esc(receipt.sender_balance.toLocaleString()));
  }

  // --- Section: Proof outputs ---
  html += '<div class="result-section">Proof Outputs</div>';
  html += row('null_0', esc(receipt.proof.null_0));
  html += row('null_1', esc(receipt.proof.null_1));
  html += row('out_cm_0', esc(receipt.proof.out_cm_0));
  html += row('out_cm_1', esc(receipt.proof.out_cm_1));
  html += row(
    'attestation_nullifier',
    esc(receipt.proof.attestation_nullifier || receipt.proof.cred_null || 'not exposed'),
  );

  // --- Section: Performance ---
  html += '<div class="result-section">Performance</div>';
  html += row('Prove', esc(String(receipt.proof.prove_ms)) + 'ms');
  html += row('Verify', esc(String(receipt.proof.verify_ms)) + 'ms');

  body.innerHTML = html;
  resultEl.classList.add('show');
}

function row(label, value) {
  return `<div class="result-row">
    <span class="result-label">${esc(label)}</span>
    <span class="result-value">${value}</span>
  </div>`;
}

function showError(msg) {
  banner.className = 'result-banner invalid';
  banner.textContent = msg;
  body.innerHTML = '';
  resultEl.classList.add('show');
}

async function verifyAuditProof(receipt) {
  const p = receipt.proof;
  if (!p || !p.proof_bytes || !p.attestation_root || !p.attestation_nullifier) {
    showError('Audit proof is missing required fields (proof_bytes, attestation_root, attestation_nullifier).');
    return;
  }

  if (!wasmReady) {
    showError('WASM not ready. Please wait and retry.');
    return;
  }

  let verified = false;
  let error = null;

  try {
    const attestationRoot = hexToU32Array(p.attestation_root);
    const attestationNullifier = hexToU32Array(p.attestation_nullifier);
    const result = verify_audit_proof(
      p.proof_bytes,
      p.window_start,
      p.window_end,
      p.claimed_total,
      attestationRoot,
      attestationNullifier,
      p.epoch || 0,
      p.log_num_rows || 4,
    );
    if (result === 'ok') {
      verified = true;
    } else {
      error = result;
    }
  } catch (e) {
    error = e.message;
  }

  if (verified) {
    banner.className = 'result-banner valid';
    banner.textContent = '\u2713 Audit proof verified. STARK proof is valid.';
  } else {
    banner.className = 'result-banner invalid';
    banner.textContent = '\u2717 Audit proof verification failed. ' + (error || 'Unknown error.');
  }

  const scale = receipt.amt_scale || 0;
  let html = '';

  if (verified) {
    html += `<div class="result-row result-row-highlight">
      <span class="result-label">STARK proof</span>
      <span class="result-value result-verified">Verified</span>
    </div>`;
  }

  html += '<div class="result-section">Proven Statement (cryptographically verified)</div>';
  html += row('Proof type', 'Audit proof');
  html += row('Window start', esc(String(p.window_start ?? '')));
  html += row('Window end', esc(String(p.window_end ?? '')));
  if (p.claimed_total != null) {
    html += row('Total volume', fmtBoundAmount(p.claimed_total, scale));
  }

  html += '<div class="result-section">Disclosed Metadata (not cryptographically verified)</div>';
  html += row('Date range', `${esc(receipt.window?.start_date || '')} to ${esc(receipt.window?.end_date || '')}`);
  html += row('Transaction count', esc(String(receipt.tx_count || '?')));
  html += row('Asset', esc(receipt.asset || ''));

  html += '<div class="result-section">Proof Metadata</div>';
  html += row('Prove time', esc(String(receipt.prove_ms || '?')) + 'ms');
  html += row('Verify time', esc(String(receipt.verify_ms || '?')) + 'ms');
  html += row('Attestation root', esc(p.attestation_root));
  html += row('Attestation nullifier', esc(p.attestation_nullifier));
  html += row('Epoch', esc(String(p.epoch || '')));

  if (receipt.disclosed) {
    html += '<div class="result-section">Disclosed Fields</div>';
    for (const [field, val] of Object.entries(receipt.disclosed)) {
      html += row(esc(field), val ? 'Disclosed' : 'Hidden');
    }
  }

  body.innerHTML = html;
  resultEl.classList.add('show');
}
