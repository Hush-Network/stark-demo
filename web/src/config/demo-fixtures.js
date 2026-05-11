import { AMT_SCALE } from './constants.js';

// Browser demo fixtures only. These values exist so a reviewer can exercise
// the proof flow without wallet onboarding, issuer integration, or note
// discovery.
export const DEMO_SPENDING_KEY = 12_345;
export const DEMO_ATTESTATION_ISSUER = 1;
export const DEMO_ATTESTATION_EXPIRY = 50_000;
export const DEMO_ATTESTATION_SECRET = 777;

export const DEMO_USER_HANDLE = 'UserName.hush';
export const DEMO_DEFAULT_RECIPIENT = 'alice.hush';
export const DEMO_DEFAULT_AMOUNT = '500.00';
export const DEMO_USER_ADDRESS = '0xf3A2...9c7b';
export const DEMO_ASSISTANT_PROMPT =
  'Ask Hush: send $50 to alice.hush, split my last dinner...';
export const DEMO_IDENTITY_STATUS = 'Verified Hush identity';
export const DEMO_MEMBER_SINCE = 'Member since 2024';
export const DEMO_SESSION_LABEL = 'Private session';
export const DEMO_SESSION_COPY = 'End-to-end encrypted via Hush Network.';
export const DEMO_PRIVACY_NOTE =
  'Transaction amounts, senders, and recipients are encrypted onchain, so only you can see your history.';
export const DEMO_FALLBACK_BALANCE = 2_847.5;

export const DEMO_INITIAL_BALANCES_UNITS = {
  USDC: 2_000 * AMT_SCALE,
  USDT: 1_000 * AMT_SCALE,
};

// 1,284.32 HUSH in protocol units.
export const DEMO_INITIAL_HUSH_BALANCE_UNITS = 12_843_200;
