import { esc, fmtAssetValue, fmtFee, fmtMoney } from '../lib/formatters.js';

export function renderActivityStage({ latestTx, activityHtml, transactionCount }) {
  const actions = latestTx
        ? `
      <div class="card stub-card" style="display:flex; gap:12px; flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="showReceipt('${esc(latestTx.id)}')">Latest receipt</button>
        <button class="btn btn-ghost" onclick="openAuditModal()">Create audit proof</button>
        <button class="btn btn-ghost" onclick="openVerifierFromSuccess('${esc(latestTx.id)}')">Verify receipt</button>
      </div>`
    : `
      <div class="card stub-card" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
        <span style="color:var(--ink-2);">Send a payment from the Wallet view to generate a receipt and audit proof.</span>
        <button class="btn btn-ghost" onclick="openAuditModal()" ${transactionCount ? '' : 'disabled'}>Create audit proof</button>
        <a class="btn btn-ghost" href="/verify.html">Open verifier</a>
      </div>`;

  return `${actions}
    <section class="card ledger-panel" id="activity-card">
      <div class="panel-head"><div><div class="panel-kicker">Ledger</div><h2>Payments and receipts</h2></div></div>
      ${activityHtml}
    </section>`;
}

export function renderComplianceStage({ transactionCount }) {
  return `
    <section class="card ledger-panel">
      <div class="panel-head">
        <div>
          <div class="panel-kicker">Selective disclosure</div>
          <h2>Receipts and audit proofs</h2>
        </div>
      </div>
      <p class="empty-copy compact-empty">Generate a receipt from activity or create an audit proof for the current asset window.</p>
      <div class="card stub-card" style="display:flex; gap:12px; flex-wrap:wrap; margin-top:18px;">
        <button class="btn btn-primary" onclick="openAuditModal()" ${transactionCount ? '' : 'disabled'}>Create audit proof</button>
        <a class="btn btn-ghost" href="/verify.html">Open verifier</a>
      </div>
    </section>
  `;
}

export function renderReceiptModalContent({ tx, assetBalance }) {
  return `
    <div class="modal-top">
      <div>
        <div class="success-kicker">Selective disclosure</div>
        <h3 class="modal-title">Payment receipt</h3>
        <p class="modal-copy">Choose what to disclose. The proof bytes verify independently of what you include here.</p>
      </div>
      <button class="close-button" onclick="closeOverlay('receipt-overlay')">x</button>
    </div>
    <div class="receipt-list">
      ${renderReceiptRow('amount', 'Amount', `${fmtMoney(tx.amount)} ${tx.asset}`, true)}
      ${renderReceiptRow('timestamp', 'Date and time', tx.receipt.timestamp.replace('T', ' ').slice(0, 19), true)}
      ${renderReceiptRow('recipient', 'Recipient', tx.recipient, false)}
      ${renderReceiptRow('asset', 'Asset', tx.asset, true)}
      ${renderReceiptRow('txid', 'Payment ID', `${tx.id.slice(0, 10)}...`, false)}
      ${renderReceiptRow('sender', 'Sender', 'Wallet owner', false)}
      ${renderReceiptRow('balance', 'Sender balance', `${fmtAssetValue(assetBalance)} ${tx.asset}`, false)}
    </div>
    <div class="always-hidden">
      <strong>Always hidden</strong>
      <ul>
        <li>Past and future counterparties</li>
        <li>Full wallet history</li>
        <li>Spending key material and private note contents</li>
      </ul>
    </div>
    <div class="modal-actions">
      <button class="button-primary" onclick="copyReceipt()">Copy receipt JSON</button>
      <button class="button-secondary" onclick="copyReceiptAndVerify()">Copy and verify</button>
    </div>
  `;
}

export function renderAuditModalContent({ today, txs, activeAsset }) {
  const totalVolume = txs.reduce((sum, tx) => sum + tx.amount, 0);
  return `
    <div class="modal-top">
      <div>
        <h3 class="modal-title">Create audit proof</h3>
        <p class="modal-copy">Generate a browser-verified audit proof for a chosen period. This is a narrow demo of the time-window flow, not a full reporting product.</p>
      </div>
      <button class="close-button" onclick="closeOverlay('audit-overlay')">x</button>
    </div>
    <div class="audit-grid">
      <div class="audit-field">
        <label for="audit-start">Start date</label>
        <input id="audit-start" type="date" value="${today}">
      </div>
      <div class="audit-field">
        <label for="audit-end">End date</label>
        <input id="audit-end" type="date" value="${today}">
      </div>
    </div>
    <div class="receipt-list">
      ${renderReceiptRow('total_volume', 'Total volume', `${fmtMoney(totalVolume)} ${activeAsset}`, true)}
      ${renderReceiptRow('tx_count', 'Transaction count', String(txs.length), true)}
      ${renderReceiptRow('time_period', 'Time period', 'Selected date range', true)}
      ${renderReceiptRow('recipients', 'Recipients', 'Optional', false)}
      ${renderReceiptRow('amounts', 'Individual amounts', 'Optional', false)}
    </div>
    <div class="modal-actions">
      <button class="button-primary" onclick="generateAuditSummary()">Generate audit proof</button>
    </div>
  `;
}

export function renderAuditResultContent({ result, activeAsset }) {
  const disclosed = [];
  if (result.selected.total_volume) disclosed.push(['Total volume', `${fmtMoney(result.totalVolume)} ${activeAsset}`]);
  if (result.selected.tx_count) disclosed.push(['Transaction count', String(result.txs.length)]);
  if (result.selected.time_period) disclosed.push(['Period', `${result.startDate} to ${result.endDate}`]);
  if (result.selected.recipients) disclosed.push(['Recipients', result.txs.map((tx) => tx.recipient).join(', ')]);
  if (result.selected.amounts) disclosed.push(['Amounts', result.txs.map((tx) => `${fmtMoney(tx.amount)} ${tx.asset}`).join(' | ')]);

  const hidden = [];
  if (!result.selected.recipients) hidden.push('Counterparty identities');
  if (!result.selected.amounts) hidden.push('Individual payment amounts');
  hidden.push('Spending key material');
  hidden.push('Private note details');

  return `
    <div class="modal-top">
      <div>
        <h3 class="modal-title">Audit proof ready</h3>
        <p class="modal-copy">The proof covers the selected payment window and exports a verifiable audit payload.</p>
      </div>
      <button class="close-button" onclick="closeOverlay('audit-overlay')">x</button>
    </div>
    <div class="audit-result-block">
      <div class="audit-result-card">
        <h4>Disclosed</h4>
        ${disclosed.map(([label, value]) => `<div class="audit-result-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`).join('')}
        <div class="audit-result-row"><span>Proof time</span><span>${esc(result.proveMs.toFixed(0))}ms</span></div>
      </div>
      <div class="audit-result-card">
        <h4>Still private</h4>
        ${hidden.map((label) => `<div class="audit-result-row"><span>${esc(label)}</span><span>Hidden</span></div>`).join('')}
      </div>
    </div>
    <div class="modal-actions">
      <button class="button-secondary" onclick="openAuditModal()">New key</button>
      <button class="button-secondary" onclick="copyAuditProof()">Copy JSON</button>
      <button class="button-primary" onclick="closeOverlay('audit-overlay')">Done</button>
    </div>
  `;
}

function renderReceiptRow(field, label, value, checked) {
  return `
    <div class="receipt-row" data-field="${esc(field)}">
      <input type="checkbox" ${checked ? 'checked' : ''}>
      <div class="receipt-label">${esc(label)}</div>
      <div class="receipt-value">${esc(value)}</div>
    </div>
  `;
}
