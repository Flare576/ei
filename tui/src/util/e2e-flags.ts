/**
 * EI_E2E_MODE — bitfield for test seams that can't be solved via data seeding.
 *
 * Use prime-power bits so combinations are unambiguous:
 *   1  — skip local LLM auto-detect (fetch to :1234/:11434)
 *   2  — (reserved for next scenario)
 *   3  — flags 1 + 2 combined
 *
 * Production code should never set this. Tests pass it via env in test.use({ env: { EI_E2E_MODE: "1" } }).
 */
const E2E_MODE = parseInt(process.env.EI_E2E_MODE ?? "0", 10);

export const E2E_SKIP_LOCAL_DETECT = (E2E_MODE & 1) !== 0;
