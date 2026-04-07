import init, { verify_serialized_proof } from '../pkg/hush_demo_stark.js';

const input = document.getElementById('receipt-input');
const btnVerify = document.getElementById('btn-verify');
const resultEl = document.getElementById('result');
const banner = document.getElementById('result-banner');
const body = document.getElementById('result-body');

let wasmReady = false;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

init().then(() => {
  wasmReady = true;
}).catch((e) => {
  console.error('WASM init failed:', e);
  banner.className = 'result-banner invalid';
  banner.textContent = 'Failed to load the WASM prover. Reload the page or check your browser supports WebAssembly.';
  body.innerHTML = '';
  resultEl.classList.add('show');
});

btnVerify.addEventListener('click', verify);

const stored = sessionStorage.getItem('hush-receipt');
if (stored) {
  input.value = stored;
  sessionStorage.removeItem('hush-receipt');
  let attempts = 0;
  const tryVerify = () => {
    if (wasmReady) {
      verify();
    } else if (attempts < 50) {
      attempts += 1;
      setTimeout(tryVerify, 100);
    }
  };
  tryVerify();
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

  if (!receipt.version || !receipt.tx_id || !receipt.proof) {
    showError('Missing required fields (version, tx_id, proof).');
    return;
  }

  if (!receipt.proof.null_0 || !receipt.proof.out_cm_0) {
    showError('Receipt is missing the proof outputs needed for verification.');
    return;
  }

  let verificationResult = null;
  if (receipt.proof.proof_bytes && wasmReady) {
    try {
      const null_0 = parseInt(receipt.proof.null_0, 16);
      const null_1 = parseInt(receipt.proof.null_1, 16);
      const out_cm_0 = parseInt(receipt.proof.out_cm_0, 16);
      const out_cm_1 = parseInt(receipt.proof.out_cm_1, 16);
      const cred_null = parseInt(receipt.proof.cred_null, 16);
      const note_root = receipt.proof.note_root || 0;
      const cred_root = receipt.proof.cred_root || 0;
      const epoch = receipt.proof.epoch || 0;

      verificationResult = verify_serialized_proof(
        receipt.proof.proof_bytes,
        note_root, cred_root, epoch,
        null_0, null_1, out_cm_0, out_cm_1, cred_null
      );
    } catch (e) {
      verificationResult = 'error: ' + e.message;
    }
  }

  const verified = verificationResult === 'ok';
  const hasProofBytes = !!receipt.proof.proof_bytes;

  if (hasProofBytes && !verified) {
    banner.className = 'result-banner invalid';
    banner.textContent = '\u2717 STARK verification failed. ' + (verificationResult || 'Unknown error.');
    body.innerHTML = '';
    resultEl.classList.add('show');
    return;
  }

  if (verified) {
    banner.className = 'result-banner valid';
    banner.textContent = '\u2713 Payment proof verified. The proof bytes match the disclosed receipt.';
  } else {
    banner.className = 'result-banner partial';
    banner.textContent = '\u2713 Receipt parsed. No proof bytes were attached, so this page can only show the disclosed fields.';
  }

  const hidden = 'not disclosed';

  const verifyMs = escapeHtml(receipt.proof.verify_ms || '?');
  const verifyRow = hasProofBytes
    ? `<div class="result-row result-row-highlight">
        <span class="result-label">Payment proof</span>
        <span class="result-value result-verified">Cryptographically verified (${verifyMs}ms)</span>
      </div>`
    : '';

  const amountStr = receipt.amount
    ? escapeHtml(receipt.amount.toLocaleString() + ' ' + (receipt.asset || ''))
    : hidden;

  body.innerHTML = `
    ${verifyRow}
    <div class="result-row">
      <span class="result-label">Transaction ID</span>
      <span class="result-value">${escapeHtml(receipt.tx_id)}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Recipient</span>
      <span class="result-value">${receipt.recipient ? escapeHtml(receipt.recipient) : hidden}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Amount</span>
      <span class="result-value">${amountStr}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Asset</span>
      <span class="result-value">${receipt.asset ? escapeHtml(receipt.asset) : hidden}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Timestamp</span>
      <span class="result-value">${receipt.timestamp ? escapeHtml(receipt.timestamp) : hidden}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Sender</span>
      <span class="result-value">${receipt.sender ? escapeHtml(receipt.sender) : hidden}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Sender Balance</span>
      <span class="result-value">${receipt.sender_balance ? escapeHtml(receipt.sender_balance.toLocaleString()) : hidden}</span>
    </div>
    <div class="result-section">Proof Outputs</div>
    <div class="result-row">
      <span class="result-label">null_0</span>
      <span class="result-value">${escapeHtml(receipt.proof.null_0)}</span>
    </div>
    <div class="result-row">
      <span class="result-label">null_1</span>
      <span class="result-value">${escapeHtml(receipt.proof.null_1)}</span>
    </div>
    <div class="result-row">
      <span class="result-label">out_cm_0</span>
      <span class="result-value">${escapeHtml(receipt.proof.out_cm_0)}</span>
    </div>
    <div class="result-row">
      <span class="result-label">out_cm_1</span>
      <span class="result-value">${escapeHtml(receipt.proof.out_cm_1)}</span>
    </div>
    <div class="result-row">
      <span class="result-label">cred_null</span>
      <span class="result-value">${escapeHtml(receipt.proof.cred_null)}</span>
    </div>
    <div class="result-section">Performance</div>
    <div class="result-row">
      <span class="result-label">Prove</span>
      <span class="result-value">${escapeHtml(receipt.proof.prove_ms)}ms</span>
    </div>
    <div class="result-row">
      <span class="result-label">Verify</span>
      <span class="result-value">${verifyMs}ms</span>
    </div>
  `;

  resultEl.classList.add('show');
}

function showError(msg) {
  banner.className = 'result-banner invalid';
  banner.textContent = msg;
  body.innerHTML = '';
  resultEl.classList.add('show');
}
