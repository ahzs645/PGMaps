import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ZenEngine } from "@gorules/zen-engine";
import { Engine } from "json-rules-engine";
import { buildZenFacts, screenOminecaCutblock } from "../src/screen.mjs";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url),"utf8"));
const zen = new ZenEngine().createDecision(Buffer.from(
  JSON.stringify(read("../adapters/zen/fppr-s64.jdm.json"))));
const jre = new Engine([read("../adapters/json-rules-engine/fppr-s64.json")]);
const base = { legalAsOf:"2026-11-17", forestRegion:"Omineca",
  isAgreementHolder:true, isMinorTenure:false };

test("both actual engines match the canonical trigger for known data", async () => {
  for (const area of [0,60,60.01,78,200]) {
    const request={...base,netAreaToBeReforestedHa:area};
    const facts=buildZenFacts(request);
    const expected=screenOminecaCutblock(request);
    const zenResponse=await zen.evaluate(facts);
    assert.equal(zenResponse.result.status,expected.status,
      "ZEN and canonical diverged for area="+area);
    const jreResponse=await jre.run(facts);
    assert.equal(jreResponse.events.some(e=>e.type==="review_required"),
      expected.status==="review_required","JRE trigger mismatch area="+area);
  }
});
