import './styles/base.css';
import './styles/wallet.css';
import {
  createAuditProof,
  createDemoAttestationProof,
  initWasmRuntime,
  quotePayment,
  submitDemoPayment,
} from './api/wasm-adapter.js';
import { AMT_SCALE, HUSH_USD_PRICE } from './config/constants.js';
import {
  DEMO_ATTESTATION_EXPIRY,
  DEMO_ATTESTATION_ISSUER,
  DEMO_ATTESTATION_SECRET,
  DEMO_FALLBACK_BALANCE,
  DEMO_DEFAULT_AMOUNT,
  DEMO_DEFAULT_RECIPIENT,
  DEMO_INITIAL_BALANCES_UNITS,
  DEMO_INITIAL_HUSH_BALANCE_UNITS,
  DEMO_SPENDING_KEY,
  DEMO_USER_ADDRESS,
  DEMO_USER_HANDLE,
} from './config/demo-fixtures.js';
import {
  createReceiptId,
  esc,
  fmtAssetValue,
  fmtFee,
  fmtHash4,
  fmtMoney,
  parseAmountInput,
  relativeTime,
  sanitizeAmountInput,
} from './lib/formatters.js';
import { buildAuditPayload, buildReceiptPayload as buildSelectableReceiptPayload } from './lib/demo-payloads.js';
import {
  assetId,
  deriveRecipientOwner,
  feeScheduleLabel,
  feeScheduleVersion,
} from './lib/demo-routes.js';
import {
  renderActivity,
  renderPayoutPreview,
  renderProofLog,
  renderProofOutputs,
} from './lib/renderers.js';
import {
  renderSidebar,
  renderTopbar,
  renderBalanceCard,
  renderBalancesTable,
  renderRecentActivity,
  renderPrivacyNote,
  renderTweaksPanel,
  renderComposerOverlay,
} from './lib/walletShell.js';
import { createInitialState, makeLog } from './state/demo-state.js';
import {
  renderActivityStage,
  renderAuditModalContent,
  renderAuditResultContent,
  renderComplianceStage,
  renderReceiptModalContent,
} from './ui/views.js';

let wasmReady = false;
let wasmError = null;

const state = createInitialState();

const splash = document.getElementById('splash');
const app = document.getElementById('app');
const stage = document.getElementById('stage');
const rail = document.getElementById('rail');
const sidebarEl = document.getElementById('sidebar');
const topbarEl = document.getElementById('topbar');
const tweaksEl = document.getElementById('tweaks');
const composerOverlayEl = document.getElementById('composer-overlay');
const truthContent = document.getElementById('truth-content');

function balanceDisplayFor(sym) {
  if (sym === 'USDT' || sym === 'USDC') {
    const bal = state.balancesUnits[sym] / AMT_SCALE;
    return { balance: fmtMoney(bal), value: `$${fmtMoney(bal)}` };
  }
  if (sym === 'HUSH') {
    const bal = state.hushBalanceUnits / AMT_SCALE;
    return { balance: fmtMoney(bal), value: `$${fmtMoney(bal * HUSH_USD_PRICE)}` };
  }
  return { balance: '0.00', value: '$0.00' };
}

const ACCENT_PRESETS = {
  mint:   { accent: '#0891b2', accent2: '#22d3ee', deep: '#5eead4' },
  sage:   { accent: '#10b981', accent2: '#5eead4', deep: '#34d399' },
  violet: { accent: '#8b5cf6', accent2: '#a78bfa', deep: '#c4b5fd' },
  sky:    { accent: '#0ea5e9', accent2: '#38bdf8', deep: '#7dd3fc' },
  rose:   { accent: '#f43f5e', accent2: '#fb7185', deep: '#fda4af' },
};

async function boot() {
  const minimumSplash = new Promise(resolve => setTimeout(resolve, 450));
  await Promise.all([initWasmRuntime(), minimumSplash]);
  wasmReady = true;
  try {
    state.provenanceProof = createDemoAttestationProof(
      DEMO_SPENDING_KEY,
      DEMO_ATTESTATION_ISSUER,
      DEMO_ATTESTATION_EXPIRY,
      DEMO_ATTESTATION_SECRET,
    );
  } catch (error) {
    console.error('Provenance attestation proof unavailable:', error);
  }
  render();
  splash.classList.add('hidden');
  app.classList.add('visible');
}

boot().catch((error) => {
  wasmError = error;
  console.error('WASM init failed:', error);
  const copy = document.querySelector('.splash-copy');
  if (copy) copy.textContent = `Failed to load prover: ${error.message}`;
});

function applyShellAttributes() {
  if (!app) return;
  app.setAttribute('data-theme', state.theme);
  app.setAttribute('data-density', state.tweaks.density);
  app.setAttribute('data-card', state.tweaks.cardStyle);
  const preset = ACCENT_PRESETS[state.tweaks.accent] || ACCENT_PRESETS.mint;
  app.style.setProperty('--brand-accent', preset.accent);
  app.style.setProperty('--brand-accent-2', preset.accent2);
  app.style.setProperty('--brand-accent-deep', preset.deep);
  app.style.setProperty('--w-radius', `${state.tweaks.radius}px`);
  app.style.setProperty('--w-size-base', `${state.tweaks.fontSize}px`);
  if (tweaksEl) tweaksEl.classList.toggle('open', state.tweaksOpen);
  app.classList.toggle('sidebar-open', state.sidebarOpen);
}

function render() {
  applyShellAttributes();
  if (sidebarEl) sidebarEl.innerHTML = renderSidebar(state.activeView);
  if (topbarEl) topbarEl.innerHTML = renderTopbar(state.theme, DEMO_USER_HANDLE);
  if (stage) stage.innerHTML = renderStage();
  if (rail) rail.innerHTML = renderRail();
  if (tweaksEl) tweaksEl.innerHTML = renderTweaksPanel(state);
  if (composerOverlayEl) {
    composerOverlayEl.innerHTML = state.composerOpen ? renderComposerOverlay(renderComposerBody()) : '';
    composerOverlayEl.classList.toggle('show', state.composerOpen);
  }
  if (truthContent) truthContent.innerHTML = renderTruthOverlayView();
  const amountInput = document.getElementById('amount-input');
  const recipientInput = document.getElementById('recipient-input');
  if (amountInput) amountInput.value = state.currentAmountInput;
  if (recipientInput) recipientInput.value = state.currentRecipient;
  refreshSendSummary();
}

function renderRail() {
  return renderRecentActivity(state.transactions) + renderPrivacyNote();
}

function currentAmount() {
  return parseAmountInput(state.currentAmountInput);
}

function balanceAmountFor(asset) {
  if (asset === 'HUSH') return state.hushBalanceUnits / AMT_SCALE;
  return state.balancesUnits[asset] / AMT_SCALE;
}

function balanceUnitsFor(asset) {
  if (asset === 'HUSH') return state.hushBalanceUnits;
  return state.balancesUnits[asset];
}

function currentFeeAsset() {
  return state.feeMode === 'hush' ? 'HUSH' : state.activeAsset;
}

function currentBalance() {
  return balanceAmountFor(state.activeAsset);
}

function currentBalanceUnits() {
  return balanceUnitsFor(state.activeAsset);
}

function currentHushBalance() {
  return state.hushBalanceUnits / AMT_SCALE;
}

function currentQuote() {
  const amount = currentAmount();
  if (!wasmReady || amount <= 0) return null;
  const amountUnits = Math.max(1, Math.round(amount * AMT_SCALE));
  const response = quotePayment(
    assetId(state.activeAsset),
    assetId(currentFeeAsset()),
    amountUnits,
    currentFeeScheduleVersion(),
  );
  return response.ok ? response.data : null;
}

function currentFeeScheduleVersion() {
  return feeScheduleVersion(state.transactions.length);
}

function currentFeeScheduleLabel() {
  return feeScheduleLabel(currentFeeScheduleVersion());
}

function currentPaymentDebit(quote = currentQuote()) {
  return quote ? quote.payment_debit / AMT_SCALE : currentAmount();
}

function currentHushDebit(quote = currentQuote()) {
  return quote ? quote.hush_fee_debit / AMT_SCALE : 0;
}

function currentTotalLabel(quote = currentQuote()) {
  if (!quote) return `${fmtMoney(currentAmount())} ${state.activeAsset}`;
  if (quote.hush_fee_debit > 0) {
    return `${fmtMoney(currentAmount())} ${state.activeAsset} + ${fmtFee(currentHushDebit(quote))} HUSH`;
  }
  return `${fmtAssetValue(currentPaymentDebit(quote))} ${state.activeAsset}`;
}

function canSendCurrentPayment() {
  if (!wasmReady || wasmError || state.isSending) return false;
  const recipient = state.currentRecipient.trim();
  const amount = currentAmount();
  const quote = currentQuote();
  if (!recipient || !amount || amount <= 0 || !quote) return false;
  if (quote.payment_debit > currentBalanceUnits()) return false;
  if (quote.hush_fee_debit > state.hushBalanceUnits) return false;
  return true;
}

function showToast(message, type = 'info') {
  const toasts = document.getElementById('toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toasts.appendChild(toast);
  setTimeout(() => toast.remove(), 3800);
}

function pushLog(kind, message) {
  state.proofLog.unshift(makeLog(kind, message));
  state.proofLog = state.proofLog.slice(0, 8);
}

function resetProofScope() {
  state.timings = null;
  state.proofOutputs = [];
  state.proofLog = [makeLog('info', 'Waiting for the first payment proof.')];
}

function provenanceStatusLabel() {
  if (state.provenanceStatus === 'revoked') return 'Revoked';
  if (state.provenanceStatus === 'sanctioned') return 'Sanctioned';
  return 'Valid';
}

function currentAssetTransactions() {
  return state.transactions.filter((tx) => tx.asset === state.activeAsset);
}

function refreshSendSummary() {
  const amount = currentAmount();
  const quote = currentQuote();
  const amountEl = document.getElementById('summary-amount');
  const feeEl = document.getElementById('summary-fee');
  const totalEl = document.getElementById('summary-total');
  const routeEl = document.getElementById('summary-route');

  if (amountEl) amountEl.textContent = `${fmtMoney(amount)} ${state.activeAsset}`;
  if (feeEl) {
    feeEl.textContent = quote
      ? `${fmtFee(quote.fee_amount / AMT_SCALE)} ${currentFeeAsset()}`
      : '--';
  }
  if (totalEl) totalEl.textContent = currentTotalLabel(quote);
  if (routeEl) {
    routeEl.textContent = `${state.feeMode === 'hush' ? `${state.activeAsset} -> HUSH` : `${state.activeAsset} -> ${state.activeAsset}`} | ${currentFeeScheduleLabel()}`;
  }
}

// The composer body is the existing payment panel content. Same IDs and same
// onclick handlers, preserving all wiring to sendPayment, updateAmount, etc.
function renderComposerBody() {
  const quote = currentQuote();
  const routeArrowLabel = state.feeMode === 'hush' ? `${state.activeAsset} -> HUSH` : `${state.activeAsset} -> ${state.activeAsset}`;
  return `
    <section class="payment-panel" id="composer">
      <div class="payment-grid">
        <div class="composer-form">
          <div class="field">
            <label for="recipient-input">Recipient</label>
            <input id="recipient-input" type="text" value="${esc(state.currentRecipient)}" placeholder="Recipient name or wallet reference" oninput="updateRecipient(this.value)">
          </div>
          <div class="field">
            <label for="amount-input">Amount</label>
            <input id="amount-input" type="text" value="${esc(state.currentAmountInput)}" inputmode="decimal" placeholder="0.00" oninput="updateAmount(this.value)">
          </div>
          <div class="composer-presets">
            <button class="asset-tab ${currentAmount() === 50 ? 'active' : ''}" onclick="setAmountPreset('50.00')">$50</button>
            <button class="asset-tab ${currentAmount() === 100 ? 'active' : ''}" onclick="setAmountPreset('100.00')">$100</button>
            <button class="asset-tab ${currentAmount() === 500 ? 'active' : ''}" onclick="setAmountPreset('500.00')">$500</button>
            <button class="asset-tab ${currentAmount() === 1000 ? 'active' : ''}" onclick="setAmountPreset('1,000.00')">$1,000</button>
          </div>
          <div class="field">
            <label>Asset</label>
            <div class="asset-tabs">
              <button class="asset-tab ${state.activeAsset === 'USDC' ? 'active' : ''}" onclick="switchAsset('USDC')">USDC</button>
              <button class="asset-tab ${state.activeAsset === 'USDT' ? 'active' : ''}" onclick="switchAsset('USDT')">USDT</button>
              <button class="asset-tab ${state.activeAsset === 'HUSH' ? 'active' : ''}" onclick="switchAsset('HUSH')">HUSH</button>
            </div>
          </div>
          <div class="field">
            <label>Fee</label>
            <div class="asset-tabs composer-route-tabs">
              <button class="asset-tab ${state.feeMode === 'same_asset' ? 'active' : ''}" onclick="switchFeeMode('same_asset')">Pay in ${state.activeAsset}</button>
              ${state.activeAsset === 'HUSH' ? '' : `<button class="asset-tab ${state.feeMode === 'hush' ? 'active' : ''}" onclick="switchFeeMode('hush')">Pay in HUSH</button>`}
            </div>
          </div>
        </div>

        <div class="quote-panel">
          <div class="quote-list">
            <div class="quote-row"><span>Payment</span><strong id="summary-amount">${fmtMoney(currentAmount())} ${state.activeAsset}</strong></div>
            <div class="quote-row"><span>Fee</span><strong id="summary-fee">${quote ? `${fmtFee(quote.fee_amount / AMT_SCALE)} ${currentFeeAsset()}` : '--'}</strong></div>
            <div class="quote-row"><span>Total debit</span><strong id="summary-total">${currentTotalLabel(quote)}</strong></div>
            <div class="quote-row"><span>Route</span><strong id="summary-route">${routeArrowLabel}</strong></div>
          </div>
          <button class="button-primary button-full" onclick="sendPayment()" ${state.isSending ? 'disabled' : ''}>${state.isSending ? 'Generating proof...' : 'Send private payment'}</button>
        </div>
      </div>
    </section>
  `;
}

function renderStage() {
  switch (state.activeView) {
    case 'wallet': {
      const stablesUsd = (state.balancesUnits.USDC + state.balancesUnits.USDT) / AMT_SCALE;
      const hushUsd = (state.hushBalanceUnits / AMT_SCALE) * HUSH_USD_PRICE;
      const headline = stablesUsd + hushUsd;
      return renderBalanceCard(state, { handle: DEMO_USER_HANDLE, headlineBalance: headline })
        + renderBalancesTable(state, balanceDisplayFor);
    }
    case 'activity': {
      const latestTx = state.successTxId ? getTransaction(state.successTxId) : null;
      return renderActivityStage({
        latestTx,
        activityHtml: renderActivity(state.activity),
        transactionCount: state.transactions.length,
      });
    }
    case 'compliance':
      return renderComplianceStage({ transactionCount: state.transactions.length });
    default:
      return renderBalanceCard(state, { handle: DEMO_USER_HANDLE, headlineBalance: DEMO_FALLBACK_BALANCE })
        + renderBalancesTable(state, balanceDisplayFor);
  }
}

function renderTruthOverlayView() {
  const hasPaymentMetrics = Boolean(state.timings);
  const hasAuditMetric = Boolean(state.auditResult);
  const hasAnySessionData = hasPaymentMetrics || hasAuditMetric;

  return `
    <div class="rail-section truth-modal-section">
      ${hasAnySessionData ? `
        <div class="metrics-grid">
          ${hasPaymentMetrics ? `
            <div class="metric-card"><span>Payment prove</span><strong>${state.timings.prove.toFixed(0)}ms</strong></div>
            <div class="metric-card"><span>Payment verify</span><strong>${state.timings.verify.toFixed(0)}ms</strong></div>
            <div class="metric-card"><span>Accounting</span><strong>${state.timings.accounting.toFixed(1)}ms</strong></div>
          ` : ''}
          ${hasAuditMetric ? `
            <div class="metric-card"><span>Audit proof</span><strong>${state.auditResult.proveMs.toFixed(0)}ms</strong></div>
          ` : ''}
        </div>
      ` : `
        <div class="session-empty">No proof run yet.</div>
      `}

      <div class="rail-card session-card">
        <div class="truth-block-head">
          <div class="rail-kicker">Latest proof</div>
          <a class="truth-modal-link" href="https://github.com/Hush-Network/stark-demo" target="_blank" rel="noreferrer">Public repo</a>
        </div>
        ${wasmError ? `
          <div class="session-empty" style="border-color:rgba(239,68,68,0.35);color:#fca5a5;">WASM failed to load: ${esc(wasmError.message)}</div>
        ` : state.isSending ? `
          <div class="proving-live">
            <span class="proving-dot"></span>
            <span>Generating STARK proof...</span>
          </div>
        ` : state.timings ? `
          <div class="proof-log-live">
            ${renderProofLog(state.proofLog)}
          </div>
          <details class="rail-details" ${state.proofOutputs.length ? 'open' : ''}>
            <summary>Public outputs</summary>
            <div class="rail-details-body">
              ${renderProofOutputs(state.proofOutputs)}
            </div>
          </details>
        ` : `
          <div class="session-empty">No payment proof yet.</div>
        `}
        <details class="rail-details">
          <summary>Provenance</summary>
          <div class="rail-details-body">
            ${
              state.provenanceProof
                ? `<div class="proof-output" style="margin-bottom:12px;">
                    <div class="proof-output-label">Local proof</div>
                    <div class="proof-output-value">${state.provenanceProof.success ? 'Verified' : 'Failed'}</div>
                    <div class="proof-output-note">${state.provenanceProof.prove_time_ms ? `${state.provenanceProof.prove_time_ms.toFixed(0)}ms` : '--'}</div>
                  </div>`
                : ''
            }
            <div class="sim-controls">
              <button class="sim-button ${state.provenanceStatus === 'valid' ? 'active' : ''}" onclick="setProvenanceStatus('valid')">Valid</button>
              <button class="sim-button ${state.provenanceStatus === 'revoked' ? 'active' : ''}" onclick="setProvenanceStatus('revoked')">Revoked</button>
              <button class="sim-button ${state.provenanceStatus === 'sanctioned' ? 'active' : ''}" onclick="setProvenanceStatus('sanctioned')">Sanctioned</button>
            </div>
          </div>
        </details>
        <details class="rail-details" ${state.lastSubmission ? 'open' : ''}>
          <summary>Payout preview</summary>
          <div class="rail-details-body">
            ${renderPayoutPreview(state.lastSubmission, AMT_SCALE)}
          </div>
        </details>
      </div>
    </div>
  `;
}

window.switchAsset = function switchAsset(asset) {
  state.activeAsset = asset;
  // HUSH same-asset is the only valid HUSH-payment route; the sidecar mode
  // would be (Hush, Hush) which is identical, so force same-asset feeMode.
  if (asset === 'HUSH') state.feeMode = 'same_asset';
  render();
};

window.switchFeeMode = function switchFeeMode(mode) {
  state.feeMode = mode;
  refreshSendSummary();
  render();
};

window.updateRecipient = function updateRecipient(value) {
  state.currentRecipient = value;
};

window.updateAmount = function updateAmount(value) {
  const normalized = sanitizeAmountInput(value);
  state.currentAmountInput = normalized;
  const input = document.getElementById('amount-input');
  if (input && input.value !== normalized) input.value = normalized;
  refreshSendSummary();
};

window.setAmountPreset = function setAmountPreset(value) {
  state.currentAmountInput = value;
  render();
};

window.setProvenanceStatus = function setProvenanceStatus(status) {
  state.provenanceStatus = status;
  render();
};

window.restartDemo = function restartDemo() {
  state.provenanceStatus = 'valid';
  state.activeAsset = 'USDC';
  state.feeMode = 'same_asset';
  state.currentRecipient = DEMO_DEFAULT_RECIPIENT;
  state.currentAmountInput = DEMO_DEFAULT_AMOUNT;
  state.balancesUnits = { ...DEMO_INITIAL_BALANCES_UNITS };
  state.hushBalanceUnits = DEMO_INITIAL_HUSH_BALANCE_UNITS;
  state.activity = [];
  state.transactions = [];
  state.receiptTxId = null;
  state.successTxId = null;
  state.auditLoading = false;
  state.auditResult = null;
  state.isSending = false;
  state.lastSubmission = null;
  state.activeView = 'wallet';
  resetProofScope();
  closeOverlay('receipt-overlay');
  closeOverlay('audit-overlay');
  render();
};

window.scrollToTruth = function scrollToTruth() {
  window.openTruthModal();
};

window.openTruthModal = function openTruthModal() {
  const element = document.getElementById('truth-overlay');
  if (element) element.classList.add('show');
};

function closeOverlay(id, event) {
  if (event && event.target !== event.currentTarget) return;
  const element = document.getElementById(id);
  if (element) element.classList.remove('show');
}

window.closeOverlay = closeOverlay;

async function sendPayment() {
  if (!wasmReady || state.isSending) return;

  const recipient = state.currentRecipient.trim();
  const amount = currentAmount();
  const quote = currentQuote();

  if (!recipient) {
    showToast('Choose a recipient before sending.', 'error');
    return;
  }

  if (!amount || amount <= 0) {
    showToast('Enter an amount before sending.', 'error');
    return;
  }

  if (!quote) {
    showToast('Unable to quote this payment route.', 'error');
    return;
  }

  const paymentDebit = currentPaymentDebit(quote);
  const hushDebit = currentHushDebit(quote);

  if (quote.payment_debit > currentBalanceUnits()) {
    showToast('Insufficient balance.', 'error');
    return;
  }

  if (quote.hush_fee_debit > state.hushBalanceUnits) {
    showToast('Insufficient balance.', 'error');
    return;
  }

  state.isSending = true;
  resetProofScope();
  pushLog('info', `${quote.route === 'mode_b_hush_sidecar' ? 'HUSH sidecar' : 'Same-asset fee'}: ${fmtFee(quote.fee_amount / AMT_SCALE)} ${currentFeeAsset()}.`);
  render();

  await new Promise((resolve) => setTimeout(resolve, 80));

  if (state.provenanceStatus === 'revoked') {
    pushLog('error', 'Spend blocked: lineage is in the revocation accumulator.');
    state.isSending = false;
    state.composerOpen = false;
    render();
    showToast('Provenance revoked. Payment blocked before proving.', 'error');
    return;
  }

  try {
    // 'sanctioned' state: simulate an in-circuit failure by passing an expired
    // attestation expiry through the existing demo proof path.
    const attestationExpiry =
      state.provenanceStatus === 'sanctioned' ? 1 : DEMO_ATTESTATION_EXPIRY;
    const paymentBalanceUnits = currentBalanceUnits();
    const hushBalanceUnits = state.hushBalanceUnits;
    const amountUnits = Math.max(1, Math.round(amount * AMT_SCALE));

    const recipientOwner = deriveRecipientOwner(recipient);

    pushLog('info', 'Generating dual fee payment bundle.');

    const response = submitDemoPayment({
      paymentAssetId: assetId(state.activeAsset),
      feeAssetId: assetId(currentFeeAsset()),
      amountUnits,
      feeScheduleVersion: currentFeeScheduleVersion(),
      recipientOwner,
      paymentBalanceUnits,
      hushBalanceUnits,
      attestationExpiry,
    });

    if (!response.ok) {
      pushLog('error', response.error);
      state.isSending = false;
      state.composerOpen = false;
      render();
      showToast(response.error, 'error');
      return;
    }

    const result = response.data;
    const paymentProof = result.payment_proof;
    const accountingStage = result.stage_timings.find((entry) => entry.label === 'accounting');
    const epochCloseStage = result.stage_timings.find((entry) => entry.label === 'epoch_close');

    pushLog('success', `Payment bundle accepted. Prove ${paymentProof.prove_time_ms.toFixed(0)}ms, verify ${paymentProof.verify_time_ms.toFixed(0)}ms.`);
    pushLog('success', `Accounting ${accountingStage.duration_ms.toFixed(2)}ms, epoch close ${epochCloseStage.duration_ms.toFixed(2)}ms.`);
    if (result.hush_sidecar) {
      pushLog('info', 'HUSH sidecar validated.');
    } else {
      pushLog('info', 'Same-asset fee path.');
    }

    state.timings = {
      prove: paymentProof.prove_time_ms,
      verify: paymentProof.verify_time_ms,
      accounting: accountingStage.duration_ms,
      epochClose: epochCloseStage.duration_ms,
    };

    state.proofOutputs = [
      { label: 'null_0', value: fmtHash4(paymentProof.null_0), note: 'First consumed payment note.' },
      { label: 'null_1', value: fmtHash4(paymentProof.null_1), note: 'Second consumed payment note.' },
      { label: 'out_cm_0', value: fmtHash4(paymentProof.out_cm_0), note: 'Committed note for the recipient.' },
      { label: 'out_cm_1', value: fmtHash4(paymentProof.out_cm_1), note: 'Committed sender payment-asset change note.' },
    ];
    if (result.hush_sidecar) {
      state.proofOutputs.push({
        label: 'hush_change_cm',
        value: fmtHash4(result.hush_sidecar.change_cm),
        note: 'Committed sender HUSH change note from the fee sidecar.',
      });
    }

    state.lastSubmission = result;
    if (state.activeAsset === 'HUSH') {
      state.hushBalanceUnits -= quote.payment_debit;
    } else {
      state.balancesUnits[state.activeAsset] -= quote.payment_debit;
    }
    if (quote.hush_fee_debit > 0) {
      state.hushBalanceUnits -= quote.hush_fee_debit;
    }

    const txId = createReceiptId();
    const tx = {
      id: txId,
      recipient,
      amount,
      asset: state.activeAsset,
      feeAmount: quote.fee_amount / AMT_SCALE,
      feeAsset: currentFeeAsset(),
      totalDebited: currentTotalLabel(quote),
      time: new Date(),
      unixTimestamp: Math.floor(Date.now() / 1000),
      receipt: {
        version: 2,
        receipt_id: txId,
        amt_scale: AMT_SCALE,
        amount_units: amountUnits,
        timestamp: new Date().toISOString(),
        recipient,
        asset: state.activeAsset,
        amount,
        proof: {
          null_0: fmtHash4(paymentProof.null_0),
          null_1: fmtHash4(paymentProof.null_1),
          out_cm_0: fmtHash4(paymentProof.out_cm_0),
          out_cm_1: fmtHash4(paymentProof.out_cm_1),
          prove_ms: Math.round(paymentProof.prove_time_ms),
          verify_ms: Math.round(paymentProof.verify_time_ms),
          proof_bytes: paymentProof.proof_bytes,
          note_root: fmtHash4(paymentProof.note_root),
          accumulator_root: fmtHash4(paymentProof.accumulator_root),
          epoch: paymentProof.epoch,
          tx_binding_hash: fmtHash4(paymentProof.tx_binding_hash),
          sender_binding_tag: fmtHash4(paymentProof.sender_binding_tag),
          log_num_rows: paymentProof.log_num_rows,
        },
        binding: {
          replay_domain: result.tx.descriptor.replay_domain,
          payment_asset: result.tx.descriptor.payment_asset,
          fee_asset: result.tx.descriptor.fee_asset,
          fee_class: result.tx.descriptor.fee_class,
          fee_amount: result.tx.descriptor.fee_amount,
          fee_schedule_version: result.tx.descriptor.fee_schedule_version,
          recipient_amount: result.tx.recipient.amount,
          recipient_owner: result.tx.recipient.owner,
          recipient_randomness: result.tx.recipient.randomness,
          sender_change_amount: result.tx.sender_change.amount,
          sender_change_randomness: result.tx.sender_change.randomness,
        },
      },
    };

    state.transactions.unshift(tx);
    state.activity.unshift({
      kind: 'payment',
      icon: 'PAY',
      title: `Sent ${fmtMoney(amount)} ${state.activeAsset}`,
      copy: quote.hush_fee_debit > 0
        ? `${fmtMoney(amount)} ${state.activeAsset} sent. Network fee paid in HUSH.`
        : `${fmtMoney(amount)} ${state.activeAsset} sent.`,
      recipient,
      asset: state.activeAsset,
      amount,
      feeAmount: quote.fee_amount / AMT_SCALE,
      feeAsset: currentFeeAsset(),
      id: tx.id,
      time: tx.time,
    });

    state.successTxId = txId;
    state.receiptTxId = txId;
    state.isSending = false;
    state.composerOpen = false;
    render();
    showToast(`Payment sent to ${recipient}.`, 'success');
  } catch (error) {
    pushLog('error', `Payment proof failed: ${error.message}`);
    state.isSending = false;
    state.composerOpen = false;
    render();
    showToast(`Payment bundle failed: ${error.message}`, 'error');
  }
}

window.sendPayment = sendPayment;

function getTransaction(txId) {
  return state.transactions.find((tx) => tx.id === txId);
}

function buildReceiptPayload(txId) {
  const tx = getTransaction(txId);
  if (!tx) return null;
  const selectedFields = {};
  document.querySelectorAll('#receipt-content [data-field]').forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    selectedFields[row.dataset.field] = !!checkbox?.checked;
  });

  return buildSelectableReceiptPayload({
    tx,
    amtScale: AMT_SCALE,
    selectedFields,
    senderLabel: DEMO_USER_HANDLE,
    senderBalance: balanceAmountFor(tx.asset),
  });
}

window.openVerifierFromSuccess = function openVerifierFromSuccess(txId) {
  state.receiptTxId = txId;
  window.copyReceiptAndVerify();
};

window.showReceipt = function showReceipt(txId) {
  state.receiptTxId = txId;
  const tx = getTransaction(txId);
  if (!tx) return;

  const container = document.getElementById('receipt-content');
  container.innerHTML = renderReceiptModalContent({
    tx,
    assetBalance: balanceAmountFor(tx.asset),
  });

  document.getElementById('receipt-overlay').classList.add('show');
};

window.copyReceipt = async function copyReceipt() {
  const receipt = buildReceiptPayload(state.receiptTxId);
  if (!receipt) return;
  const payload = JSON.stringify(receipt, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    localStorage.setItem('hush-receipt', payload);
    showToast('Receipt copied to clipboard.', 'success');
    closeOverlay('receipt-overlay');
  } catch {
    showToast('Failed to copy receipt.', 'error');
  }
};

window.copyReceiptAndVerify = async function copyReceiptAndVerify() {
  const receipt = buildReceiptPayload(state.receiptTxId);
  if (!receipt) return;
  const payload = JSON.stringify(receipt, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    // ignore clipboard failure, still continue with verifier handoff
  }
  localStorage.setItem('hush-receipt', payload);
  window.open('/verify.html', '_blank');
};

window.openAuditModal = function openAuditModal() {
  const txs = currentAssetTransactions();
  if (!txs.length) {
    showToast(`Send a ${state.activeAsset} payment first so the demo has something to summarize.`, 'info');
    return;
  }

  state.auditResult = null;
  const today = new Date().toISOString().split('T')[0];
  const container = document.getElementById('audit-content');
  container.innerHTML = renderAuditModalContent({
    today,
    txs,
    activeAsset: state.activeAsset,
  });
  document.getElementById('audit-overlay').classList.add('show');
};

window.generateAuditSummary = async function generateAuditSummary() {
  if (state.auditLoading) return;
  const selected = {};
  document.querySelectorAll('#audit-content [data-field]').forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    selected[row.dataset.field] = !!checkbox?.checked;
  });
  const startDate = document.getElementById('audit-start')?.value;
  const endDate = document.getElementById('audit-end')?.value;

  state.auditLoading = true;
  const trigger = document.querySelector('#audit-content .button-primary');
  if (trigger) {
    trigger.disabled = true;
    trigger.textContent = 'Generating...';
  }

  pushLog('info', 'Generating audit proof in the browser.');

  await new Promise((resolve) => setTimeout(resolve, 80));

  try {
    const nowTs = Math.floor(Date.now() / 1000);
    const txs = currentAssetTransactions();
    const startTs = startDate ? Math.floor(new Date(startDate + 'T00:00:00').getTime() / 1000) : (txs[0]?.unixTimestamp || nowTs);
    const endTs = endDate ? Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000) : nowTs;
    const scopedTxs = txs.filter((tx) => {
      const timestamp = tx.unixTimestamp || nowTs;
      return timestamp >= startTs && timestamp <= endTs;
    });

    if (!scopedTxs.length) {
      throw new Error('No payments fall inside the selected window.');
    }

    const amounts = Float64Array.from(
      scopedTxs.map((tx) => Math.max(1, Math.round(tx.amount * AMT_SCALE))),
    );
    const timestamps = new Uint32Array(scopedTxs.map((tx) => tx.unixTimestamp || nowTs));
    const result = createAuditProof({
      startTs,
      endTs,
      amounts,
      timestamps,
      spendingKey: DEMO_SPENDING_KEY,
      issuerId: DEMO_ATTESTATION_ISSUER,
      expiry: DEMO_ATTESTATION_EXPIRY,
      secret: DEMO_ATTESTATION_SECRET,
    });

    if (!result.success) {
      pushLog('error', result.message);
      state.auditLoading = false;
      if (trigger) {
        trigger.disabled = false;
        trigger.textContent = 'Generate audit proof';
      }
      showToast(result.message, 'error');
      return;
    }

    const totalVolume = scopedTxs.reduce((sum, tx) => sum + tx.amount, 0);

    state.auditResult = {
      proveMs: result.prove_time_ms,
      verifyMs: result.verify_time_ms,
      totalVolume,
      startDate,
      endDate,
      selected,
      txs: scopedTxs,
      proof_bytes: result.proof_bytes,
      window_start: result.window_start,
      window_end: result.window_end,
      claimed_total: result.claimed_total,
      attestation_root: result.attestation_root,
      attestation_nullifier: result.attestation_nullifier,
      epoch: result.epoch,
      log_num_rows: result.log_num_rows,
    };

    pushLog('success', `Audit proof generated in ${result.prove_time_ms.toFixed(0)}ms, verified in ${result.verify_time_ms.toFixed(0)}ms.`);

    state.activity.unshift({
      kind: 'audit',
      icon: 'AUD',
      title: `Audit proof for ${state.activeAsset}`,
      totalVolume,
      txCount: scopedTxs.length,
      proveMs: result.prove_time_ms,
      id: 'audit-' + Date.now(),
      time: new Date(),
    });

    renderAuditResult();
    showToast('Audit proof generated.', 'success');
  } catch (error) {
    pushLog('error', `Audit proof failed: ${error.message}`);
    showToast(`Audit proof failed: ${error.message}`, 'error');
  }

  state.auditLoading = false;
  if (!state.auditResult && trigger) {
    trigger.disabled = false;
    trigger.textContent = 'Generate audit proof';
  }
};

function renderAuditResult() {
  const result = state.auditResult;
  if (!result) return;
  const container = document.getElementById('audit-content');
  container.innerHTML = renderAuditResultContent({
    result,
    activeAsset: state.activeAsset,
  });
}

window.copyAuditProof = async function copyAuditProof() {
  if (!state.auditResult) return;
  const payload = JSON.stringify(
    buildAuditPayload({
      result: state.auditResult,
      activeAsset: state.activeAsset,
      amtScale: AMT_SCALE,
    }),
    null,
    2,
  );
  try {
    await navigator.clipboard.writeText(payload);
    showToast('Audit proof copied to clipboard.', 'success');
  } catch {
    showToast('Copy failed.', 'error');
  }
};

// ============================================================================
// Wallet UI globals: handlers wired by walletShell render templates.
// ============================================================================

window.toggleTheme = function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  render();
};

window.setTheme = function setTheme(theme) {
  state.theme = theme;
  render();
};

window.setActiveView = function setActiveView(viewId) {
  state.activeView = viewId;
  if (viewId === 'compliance') {
    // Compliance view shows a stub plus opens the audit modal
    state.activeView = 'compliance';
  }
  // Auto-close the mobile sidebar drawer after a nav selection
  state.sidebarOpen = false;
  render();
};

window.toggleSidebar = function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  render();
};

window.closeSidebar = function closeSidebar() {
  if (state.sidebarOpen) {
    state.sidebarOpen = false;
    render();
  }
};

window.openComposer = function openComposer() {
  state.composerOpen = true;
  render();
};

window.closeComposerOverlay = function closeComposerOverlay(event) {
  if (event && event.target !== event.currentTarget) return;
  state.composerOpen = false;
  render();
};

window.toggleTweaks = function toggleTweaks() {
  state.tweaksOpen = !state.tweaksOpen;
  render();
};

window.setTweak = function setTweak(key, value) {
  if (key === 'radius' || key === 'fontSize') {
    // Apply continuously without re-rendering. Re-render would re-create the
    // slider element each frame and break the drag interaction.
    const num = Number(value);
    state.tweaks[key] = num;
    if (app) {
      if (key === 'radius') app.style.setProperty('--w-radius', `${num}px`);
      if (key === 'fontSize') app.style.setProperty('--w-size-base', `${num}px`);
    }
    return;
  }
  state.tweaks[key] = value;
  render();
};

window.askComingSoon = function askComingSoon(label) {
  showToast(`${label}: coming soon.`, 'info');
};

window.copyAddress = async function copyAddress() {
  try {
    await navigator.clipboard.writeText(DEMO_USER_ADDRESS);
    showToast('Address copied.', 'success');
  } catch {
    showToast('Copy failed.', 'error');
  }
};
