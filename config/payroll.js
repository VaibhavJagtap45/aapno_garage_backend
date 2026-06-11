// config/payroll.js
// ─────────────────────────────────────────────────────────────────
//  Mechanic payroll / bonus policy.
//
//  Rule (locked with product): a mechanic who completes at least
//  BONUS_SERVICE_THRESHOLD services in a calendar month earns a flat
//  BONUS_PERCENT bonus on their base salary for that month only — it
//  resets every month and never compounds into the base salary.
//
//  Override via env without code changes.
// ─────────────────────────────────────────────────────────────────

const BONUS_SERVICE_THRESHOLD = Number(process.env.PAYROLL_BONUS_THRESHOLD) || 100;
const BONUS_PERCENT = Number(process.env.PAYROLL_BONUS_PERCENT) || 2; // percent

/**
 * Compute a mechanic's payout for a month.
 * @param {number} baseSalary         monthly base salary (rupees)
 * @param {number} servicesCompleted  count of repair orders completed that month
 * @returns {{ baseSalary:number, servicesCompleted:number, threshold:number,
 *             bonusPercent:number, bonusEligible:boolean, bonusAmount:number,
 *             totalPayable:number }}
 */
function computePayout(baseSalary, servicesCompleted) {
  const base = Math.max(Number(baseSalary) || 0, 0);
  const count = Math.max(Number(servicesCompleted) || 0, 0);
  const bonusEligible = count >= BONUS_SERVICE_THRESHOLD;
  const bonusAmount = bonusEligible
    ? Number(((base * BONUS_PERCENT) / 100).toFixed(2))
    : 0;

  return {
    baseSalary: base,
    servicesCompleted: count,
    threshold: BONUS_SERVICE_THRESHOLD,
    bonusPercent: BONUS_PERCENT,
    bonusEligible,
    bonusAmount,
    totalPayable: Number((base + bonusAmount).toFixed(2)),
  };
}

module.exports = { BONUS_SERVICE_THRESHOLD, BONUS_PERCENT, computePayout };
