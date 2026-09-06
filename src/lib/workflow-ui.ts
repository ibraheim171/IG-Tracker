import type { ItemStatus, ParticipantPart } from "./ui-data.ts";

export const workflowSteps: { key: ItemStatus; label: string }[] = [
  { key: "idea", label: "فكرة" },
  { key: "writing", label: "كتابة واعتماد المحتوى" },
  { key: "content_approved", label: "اعتماد المحتوى" },
  { key: "in_production", label: "إنتاج" },
  { key: "design_approved", label: "اعتماد الإنتاج" },
  { key: "ready", label: "جاهزة للنشر" },
  { key: "published", label: "منشورة" },
];

export const workflowOrder = workflowSteps.map((step) => step.key);

export function workflowLabel(status: ItemStatus) {
  if (status === "cancelled") return "ملغاة";
  return workflowSteps.find((step) => step.key === status)?.label ?? status;
}

export function currentOwnerParts(status: ItemStatus): ParticipantPart[] {
  if (status === "idea") return ["writer"];
  if (status === "writing") return ["reviewer"];
  if (status === "content_approved") return ["producer"];
  if (status === "in_production") return ["producer", "reviewer"];
  return [];
}

export function contentStateLabel(status: ItemStatus) {
  if (status === "idea") return "مسودة";
  if (status === "writing") return "بانتظار اعتماد المحتوى";
  if (status === "cancelled") return "ملغاة";
  return "معتمد";
}

export function productionStateLabel(status: ItemStatus) {
  if (status === "cancelled") return "ملغاة";
  const index = workflowOrder.indexOf(status);
  if (index < workflowOrder.indexOf("in_production")) return "لم يبدأ";
  if (status === "in_production") return "قيد الإنتاج والاعتماد";
  return "معتمد";
}

export function isWorkflowStepComplete(current: ItemStatus, step: ItemStatus) {
  if (current === "cancelled") return false;
  return workflowOrder.indexOf(current) > workflowOrder.indexOf(step);
}

export function isWorkflowStepCurrent(current: ItemStatus, step: ItemStatus) {
  return current === step;
}
