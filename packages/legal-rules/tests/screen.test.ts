import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { buildZenFacts, screenOminecaCutblock, screenOldForestTarget, patchDistributionDistance } from "../src/screen.mjs";

const json = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const applicable = { legalAsOf:"2026-11-17", forestRegion:"Omineca",
  isAgreementHolder:true, isMinorTenure:false, netAreaToBeReforestedHa:78 };
test("FPPR §64 never reports a legal compliance decision", () => {
  assert.equal(screenOminecaCutblock(applicable).status, "review_required");
  assert.equal(screenOminecaCutblock(applicable).bindingDecision, false);
  assert.equal(screenOminecaCutblock({...applicable, netAreaToBeReforestedHa:60}).status, "within_threshold_only");
  assert.equal(screenOminecaCutblock({...applicable, netAreaToBeReforestedHa:0}).status, "within_threshold_only");
});
test("missing facts and point-in-time history fail closed", () => {
  assert.equal(screenOminecaCutblock({...applicable, isMinorTenure:undefined}).status, "indeterminate");
  assert.equal(screenOminecaCutblock({...applicable, netAreaToBeReforestedHa:undefined}).status, "indeterminate");
  assert.equal(screenOminecaCutblock({...applicable, netAreaToBeReforestedHa:-1}).status, "indeterminate");
  assert.equal(screenOminecaCutblock({...applicable, legalAsOf:"2015-05-01"}).status, "indeterminate");
  assert.equal(screenOminecaCutblock({...applicable, legalAsOf:"2026-11-22"}).status, "indeterminate");
  assert.equal(buildZenFacts({...applicable, isMinorTenure:null}).isSizeLimitApplicable, null);
});
test("out of scope and documented possible exceptions", () => {
  assert.equal(screenOminecaCutblock({...applicable, forestRegion:"Cariboo"}).status, "not_applicable");
  assert.equal(screenOminecaCutblock({...applicable, isMinorTenure:true}).status, "not_applicable");
  assert.equal(screenOminecaCutblock({...applicable, exceptionEvidence:[{
    provision:"64(3)",source:"inventory survey",reviewStatus:"submitted"
  }]}).status,"exception_review_required");
});
test("GoRules and json-rules-engine examples use the same trigger", () => {
  const zen=json("../adapters/zen/fppr-s64.jdm.json");
  const table=zen.nodes.find(n=>n.type==="decisionTableNode");
  assert.equal(table.content.hitPolicy,"first");
  assert.equal(table.content.rules[0].netarea,"> 60");
  assert.equal(table.content.rules[0].status,'"review_required"');
  assert.equal(zen.edges.length,2);
  const jre=json("../adapters/json-rules-engine/fppr-s64.json");
  assert.equal(jre.conditions.all.find(c=>c.fact==="netAreaToBeReforestedHa").value,60);
  assert.equal(jre.event.type,"review_required");
});
test("all Prince George district table 3/6 percentages and table 7 targets are present", () => {
  const order=json("../rules/bc/prince-george/2004-biodiversity-order.json");
  assert.equal(order.oldAndInteriorForest.length,49);
  assert.equal(order.youngForestPatchDistribution.targets.length,9);
  assert.equal(order.oldAndInteriorForest.find(x=>x.unit==="A7").oldForestMinPct,17);
  assert.equal(order.oldAndInteriorForest.find(x=>x.unit==="A7").interiorOfRequiredOldForestMinPct,10);
  assert.equal(order.oldAndInteriorForest.find(x=>x.unit==="A22").oldForestMinPct,53);
  for (const t of order.youngForestPatchDistribution.targets)
    assert.equal(Object.values(t.percent).reduce((a,b)=>a+b,0),100,t.ndu);
  const unit=order.oldAndInteriorForest.find(x=>x.unit==="A7");
  const result=screenOldForestTarget(unit, { cflbAreaHa:1000,
    qualifyingOldForestHa:160,qualifyingOldInteriorForestHa:14 });
  assert.equal(result.requiredOldHa,170);
  assert.equal(result.requiredInteriorHa,17);
  assert.equal(result.oldForestDeficitHa,10);
  assert.equal(result.interiorForestDeficitHa,3);
});
test("patch-distance measure is advisory, never legal compliance", () => {
  const r=patchDistributionDistance(
    {under50ha:10,between51and100ha:5,between101and1000ha:45,over1000ha:40},
    {under50ha:5,between51and100ha:5,between101and1000ha:20,over1000ha:70});
  assert.equal(r.status,"advisory_only");
  assert.equal(r.distancePercentagePoints,60);
  assert.equal(r.bindingDecision,false);
});
