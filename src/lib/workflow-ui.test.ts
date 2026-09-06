import assert from "node:assert/strict";
import test from "node:test";
import {
  contentStateLabel,
  currentOwnerParts,
  isWorkflowStepComplete,
  productionStateLabel,
  workflowLabel,
  workflowSteps,
} from "./workflow-ui.ts";

test("يعرض مراحل الـworkflow الحالية بالترتيب دون اختراع حالة جديدة", () => {
  assert.deepEqual(workflowSteps.map((step) => step.key), [
    "idea", "writing", "content_approved", "in_production", "design_approved", "ready", "published",
  ]);
  assert.equal(workflowLabel("ready"), "جاهزة للنشر");
  assert.equal(isWorkflowStepComplete("ready", "in_production"), true);
  assert.equal(isWorkflowStepComplete("idea", "writing"), false);
});

test("يشتق المسؤول الحالي من المرحلة بدل تخزين حالة واجهة مستقلة", () => {
  assert.deepEqual(currentOwnerParts("idea"), ["writer"]);
  assert.deepEqual(currentOwnerParts("writing"), ["reviewer"]);
  assert.deepEqual(currentOwnerParts("content_approved"), ["producer"]);
  assert.deepEqual(currentOwnerParts("in_production"), ["producer", "reviewer"]);
});

test("يشتق حالتي المحتوى والإنتاج من حالة المادة", () => {
  assert.equal(contentStateLabel("idea"), "مسودة");
  assert.equal(contentStateLabel("writing"), "بانتظار اعتماد المحتوى");
  assert.equal(contentStateLabel("content_approved"), "معتمد");
  assert.equal(productionStateLabel("content_approved"), "لم يبدأ");
  assert.equal(productionStateLabel("in_production"), "قيد الإنتاج والاعتماد");
  assert.equal(productionStateLabel("ready"), "معتمد");
});
