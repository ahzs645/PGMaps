/**
 * Advisory screens only: never return "compliant" or assert harvesting authorization.
 * This module has no IO; the GIS adapter is responsible for verified NAR and landbase facts.
 */
export const FPPR_S64_KNOWN_AS_OF = "2026-11-17";
export const FPPR_S64_OMINECA_LIMIT_HA = 60;
const VALID_STATES = new Set(["review_required", "exception_review_required", "within_threshold_only", "not_applicable", "indeterminate"]);

function outcome(status, reasons, extra = {}) {
  if (!VALID_STATES.has(status)) throw new TypeError("Unrecognized screen status");
  return { ruleId: "bc.fppr.64.cutblock-size", status, reasons, bindingDecision: false,
    source: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/14_2004",
    sourceSection: "64(1)-(4)", sourceConsolidationCurrentTo: FPPR_S64_KNOWN_AS_OF, ...extra };
}

export function buildZenFacts(input) {
  const validRegion = typeof input?.forestRegion === "string" && input.forestRegion.length > 0;
  const validTenure = typeof input?.isAgreementHolder === "boolean" && typeof input?.isMinorTenure === "boolean";
  const isSizeLimitApplicable = !validRegion || !validTenure ? null :
    input.forestRegion === "Omineca" && input.isAgreementHolder && !input.isMinorTenure;
  return {
    isSizeLimitApplicable,
    netAreaToBeReforestedHa: Number.isFinite(input?.netAreaToBeReforestedHa) && input.netAreaToBeReforestedHa >= 0
      ? input.netAreaToBeReforestedHa : null
  };
}

/**
 * Evaluate ONLY the §64(1) Omineca size screen at the documented consolidation date.
 * Return indeterminate if a date is omitted or the caller requests another historical/future
 * legal point in time. Do not equate gross polygon area with net area to be reforested.
 */
export function screenOminecaCutblock(input) {
  if (!input || input.legalAsOf !== FPPR_S64_KNOWN_AS_OF)
    return outcome("indeterminate", ["No verified point-in-time rule for requested legal date"]);
  const facts = buildZenFacts(input);
  if (facts.isSizeLimitApplicable === null)
    return outcome("indeterminate", ["Forest region or agreement/minor-tenure classification is missing"]);
  if (!facts.isSizeLimitApplicable)
    return outcome("not_applicable", ["This Omineca size screen does not apply; other obligations may"]);
  if (facts.netAreaToBeReforestedHa === null)
    return outcome("indeterminate", ["Verified net area to be reforested is missing or invalid"]);
  if (facts.netAreaToBeReforestedHa <= FPPR_S64_OMINECA_LIMIT_HA)
    return outcome("within_threshold_only", ["NAR is not over 60 ha; other rules remain to be reviewed"],
      { netAreaToBeReforestedHa: facts.netAreaToBeReforestedHa });
  const evidence = input.exceptionEvidence;
  if (Array.isArray(evidence) && evidence.some(x =>
    ["64(2)", "64(3)", "64(4)"].includes(x?.provision) && x?.source && x?.reviewStatus === "submitted")) {
    return outcome("exception_review_required",
      ["NAR exceeds 60 ha; supporting evidence for a §64 exception must be assessed by an authorized reviewer"],
      { netAreaToBeReforestedHa: facts.netAreaToBeReforestedHa,
        exceptionReferences: evidence.filter(x => ["64(2)", "64(3)", "64(4)"].includes(x?.provision)).map(x => x.provision) });
  }
  return outcome("review_required",
    ["NAR exceeds 60 ha; investigate §64(2)-(4) exceptions and other applicable law"],
    { netAreaToBeReforestedHa: facts.netAreaToBeReforestedHa });
}

/** Landscape-only numerical screen; authoritative mBEC polygon, old forest counts and
 * alternatives D.1–D.5 require separate spatial and professional evidence. */
export function screenOldForestTarget(unit, data) {
  if (!unit || !data) return { status: "indeterminate", reasons: ["Missing unit or landscape facts"] };
  const { cflbAreaHa, qualifyingOldForestHa, qualifyingOldInteriorForestHa } = data;
  if (![cflbAreaHa, qualifyingOldForestHa, qualifyingOldInteriorForestHa].every(Number.isFinite)
    || cflbAreaHa <= 0 || qualifyingOldForestHa < 0 || qualifyingOldInteriorForestHa < 0
    || qualifyingOldInteriorForestHa > qualifyingOldForestHa)
    return { status: "indeterminate", reasons: ["Missing or inconsistent verified landbase/forest areas"] };
  const requiredOldHa = cflbAreaHa * unit.oldForestMinPct / 100;
  const requiredInteriorHa = requiredOldHa * unit.interiorOfRequiredOldForestMinPct / 100;
  return {
    status: qualifyingOldForestHa >= requiredOldHa && qualifyingOldInteriorForestHa >= requiredInteriorHa
      ? "meets_numeric_targets_only" : "below_numeric_targets",
    bindingDecision: false, unit: unit.unit,
    requiredOldHa, requiredInteriorHa,
    oldForestDeficitHa: Math.max(0, requiredOldHa - qualifyingOldForestHa),
    interiorForestDeficitHa: Math.max(0, requiredInteriorHa - qualifyingOldInteriorForestHa),
    reasons: ["Does not decide whether counted stands qualify, alternatives apply or newer orders supersede the 2004 order"]
  };
}

/** Advisory distance only; the legal objective says "demonstrate a trend", not a fixed pass score. */
export function patchDistributionDistance(percentages, target) {
  const keys = ["under50ha","between51and100ha","between101and1000ha","over1000ha"];
  if (!percentages || !target || !keys.every(k => Number.isFinite(percentages[k]) && Number.isFinite(target[k])))
    return { status: "indeterminate" };
  if (Math.abs(keys.reduce((n,k)=>n+percentages[k],0)-100)>0.1 ||
      Math.abs(keys.reduce((n,k)=>n+target[k],0)-100)>0.1)
    return { status:"indeterminate", reason:"Percentages must total approximately 100" };
  return { status:"advisory_only", distancePercentagePoints:keys.reduce((n,k)=>n+Math.abs(percentages[k]-target[k]),0),
    bindingDecision:false, note:"Not a statutory pass/fail test; before/after spatial methods and objective D.5 must be reviewed" };
}
