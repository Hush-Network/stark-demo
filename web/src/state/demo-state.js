import {
  DEMO_DEFAULT_AMOUNT,
  DEMO_DEFAULT_RECIPIENT,
  DEMO_INITIAL_BALANCES_UNITS,
  DEMO_INITIAL_HUSH_BALANCE_UNITS,
} from '../config/demo-fixtures.js';

export function makeLog(kind, message) {
  return { kind, message, time: stamp() };
}

export function createInitialState() {
  return {
    provenanceStatus: 'valid',
    activeAsset: 'USDC',
    currentRecipient: DEMO_DEFAULT_RECIPIENT,
    currentAmountInput: DEMO_DEFAULT_AMOUNT,
    balancesUnits: { ...DEMO_INITIAL_BALANCES_UNITS },
    hushBalanceUnits: DEMO_INITIAL_HUSH_BALANCE_UNITS,
    activity: [],
    transactions: [],
    proofLog: [makeLog('info', 'Waiting for the first payment proof.')],
    proofOutputs: [],
    timings: null,
    isSending: false,
    provenanceProof: null,
    receiptTxId: null,
    successTxId: null,
    auditLoading: false,
    auditResult: null,
    lastSubmission: null,
    theme: 'dark',
    activeView: 'wallet',
    composerOpen: false,
    tweaksOpen: false,
    sidebarOpen: false,
    tweaks: {
      accent: 'mint',
      density: 'cozy',
      cardStyle: 'soft',
      radius: 14,
      fontSize: 14,
    },
  };
}

function stamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
