/**
 * The AMR cloud runtime is the upstream model router. MonoField ships it
 * switched off, and the daemon turns it on with `OD_ENABLE_AMR=1`; the renderer
 * follows the same switch through `NEXT_PUBLIC_OD_ENABLE_AMR=1` so the sign-in,
 * model polling and onboarding surfaces never appear for a build that has no AMR
 * runtime behind them.
 */
export const ENABLE_AMR_RUNTIME = process.env.NEXT_PUBLIC_OD_ENABLE_AMR === '1';
