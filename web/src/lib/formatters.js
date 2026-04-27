export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format a [u32; 4] array as a 0x-prefixed 32-char hex string (4 x 8 hex digits).
export function fmtHash4(arr) {
  if (!Array.isArray(arr) || arr.length !== 4) return '0x' + String(arr);
  return '0x' + arr.map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

export function fmtMoney(value) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtAssetValue(value) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function fmtFee(value) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function relativeTime(date) {
  const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function sanitizeAmountInput(raw) {
  const clean = raw.replace(/[^0-9.]/g, '');
  // Allow a single decimal separator. Collapse any extras after the first.
  const firstDot = clean.indexOf('.');
  const safe = firstDot === -1
    ? clean
    : clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, '');
  const parts = safe.split('.');
  const whole = parts[0] || '0';
  // Preserve the trailing dot the user just typed: parts[1] is '' when the
  // input ends in '.', undefined when no dot was typed at all.
  const hasDot = parts.length > 1;
  const decimals = hasDot ? parts[1].slice(0, 2) : null;
  const formattedWhole = Number.parseInt(whole, 10).toLocaleString('en-US');
  if (decimals === null) return formattedWhole;
  return `${formattedWhole}.${decimals}`;
}

export function parseAmountInput(value) {
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createReceiptId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
