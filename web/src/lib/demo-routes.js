export function assetId(asset) {
  if (asset === 'USDC') return 1;
  if (asset === 'USDT') return 2;
  if (asset === 'HUSH') return 3;
  throw new Error(`Unsupported asset ${asset}`);
}

export function feeScheduleVersion(transactionCount) {
  if (transactionCount >= 8) return 3;
  if (transactionCount >= 3) return 2;
  return 1;
}

export function feeScheduleLabel(version) {
  if (version === 3) return 'Peak';
  if (version === 2) return 'Busy';
  return 'Standard';
}

export function deriveRecipientOwner(recipient) {
  let hash = 0;
  for (let i = 0; i < recipient.length; i += 1) {
    hash = ((hash << 5) - hash + recipient.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 90_000) + 10_000;
}
