import init, { verify_serialized_proof, recompute_tx_binding_hash_json } from '../pkg/hush_demo_stark.js';

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

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  // Accept both old tx_id and new receipt_id
  const receiptId = receipt.receipt_id || receipt.tx_id;
  if (!receipt.version || !receiptId || !receipt.proof) {
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
      } else if (result.hash !== receipt.proof.tx_binding_hash) {
        bindingError = `Binding hash mismatch: computed ${result.hash}, receipt claims ${receipt.proof.tx_binding_hash}`;
      } else {
        bindingVerified = true;
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
      const null_0 = parseInt(receipt.proof.null_0, 16);
      const null_1 = parseInt(receipt.proof.null_1, 16);
      const out_cm_0 = parseInt(receipt.proof.out_cm_0, 16);
      const out_cm_1 = parseInt(receipt.proof.out_cm_1, 16);
      const cred_null = parseInt(receipt.proof.cred_null, 16);
      const note_root = receipt.proof.note_root || 0;
      const cred_root = receipt.proof.cred_root || 0;
      const epoch = receipt.proof.epoch || 0;
      const tx_binding_hash = receipt.proof.tx_binding_hash || 0;
      const sender_binding_tag = receipt.proof.sender_binding_tag || 0;
      const result = verify_serialized_proof(
        receipt.proof.proof_bytes,
        note_root, cred_root, epoch,
        null_0, null_1, out_cm_0, out_cm_1, cred_null,
        tx_binding_hash, sender_binding_tag
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
    const expectedUnits = Math.round(receipt.amount * receipt.amt_scale);
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
  html += row('cred_null', esc(receipt.proof.cred_null));

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
