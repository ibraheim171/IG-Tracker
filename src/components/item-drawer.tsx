"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { useReferenceData } from "@/components/reference-data-provider";
import { canEditItemAssignments, type AdminCreatedTrack, type TeamMemberOption } from "@/lib/admin-create-item";
import { type EditableItemField, getItemPermissions, safeHttpsHref } from "@/lib/item-permissions";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/database.types";
import type { DrawerPreview, IdeaTypeOption, ItemStatus, ParticipantPart, RoleName, TrackOption } from "@/lib/ui-data";
import { extractMessage, formatHebronDateTime, formatNumber, formatPercent, isAdminRole, parseRuleMessage, statusLabels } from "@/lib/ui-data";
import { contentStateLabel, currentOwnerParts, isWorkflowStepComplete, isWorkflowStepCurrent, productionStateLabel, workflowLabel, workflowSteps } from "@/lib/workflow-ui";

type ItemRow = Tables<"items">;
type PerformanceRow = Tables<"v_item_performance">;
type CurrentSlot = Pick<Tables<"publishing_slots">, "id" | "slot_at" | "state">;

type ParticipantRecord = {
  user_id: string;
  part: ParticipantPart;
  profiles: { display_name: string } | { display_name: string }[] | null;
};

type PartnerRecord = {
  partner_id: number;
  partners: { name: string } | { name: string }[] | null;
};

type ActorProfile = { display_name: string } | { display_name: string }[] | null;
type ApprovalRecord = Pick<Tables<"approvals">, "id" | "gate" | "result" | "note" | "created_at" | "actor_id"> & { profiles: ActorProfile };
type TransitionRecord = Pick<Tables<"transitions">, "id" | "from_status" | "to_status" | "note" | "override_reason" | "is_override" | "created_at" | "actor_id"> & { profiles: ActorProfile };
type OpenSlot = Pick<Tables<"v_slot_board">, "slot_id" | "slot_at" | "state" | "n_items">;

type DrawerDetails = {
  item: ItemRow;
  participants: ParticipantRecord[];
  partners: PartnerRecord[];
  approvals: ApprovalRecord[];
  transitions: TransitionRecord[];
  performance: PerformanceRow | null;
  openSlots: OpenSlot[];
  currentSlot: CurrentSlot | null;
};

type ItemDetailsResponse = { details: DrawerDetails } | { error: string };
type LoadState = "idle" | "loading" | "ready" | "error";
type SaveOptions = { showMessage: boolean; notifyList: boolean };

type EditableState = {
  title: string;
  track_id: string;
  idea_type_id: string;
  caption: string;
  notes: string;
  writer_delivery_url: string;
  production_file_url: string;
  partnerIds: string[];
  newPartner: string;
};

type AssignmentState = {
  writer_id: string;
  producer_id: string;
  reviewer_id: string;
};

type TrackState = {
  name: string;
  color_hex: string;
  sort_order: string;
};

type ConfirmDialog = {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

type Props = {
  itemId: string | null;
  initialItem?: DrawerPreview | null;
  onClose: () => void;
  onChanged?: () => void;
  currentUserId: string;
  roles: RoleName[];
  teamMembers?: TeamMemberOption[];
  largeCaption?: boolean;
};

const detailTimeoutMs = 10000;
const autoSaveDelayMs = 1800;
const itemFieldKeys: EditableItemField[] = ["title", "track_id", "idea_type_id", "caption", "notes", "writer_delivery_url", "production_file_url"];
const itemFieldKeySet = new Set<EditableItemField>(itemFieldKeys);
const itemSaveErrorMessage = "تعذر حفظ التعديلات. حاول مجددًا. رمز التشخيص: ITEM_SAVE.";
const partnersSaveErrorMessage = "تعذر حفظ الشركاء. حاول مجددًا. رمز التشخيص: PARTNERS_SAVE.";
const assignmentsSaveErrorMessage = "تعذر حفظ تعيينات المادة. حاول مجددًا. رمز التشخيص: ASSIGNMENTS_SAVE.";
const emptyTrack: TrackState = { name: "", color_hex: "#1E8F8B", sort_order: "" };

function profileName(value: ParticipantRecord["profiles"]) {
  if (Array.isArray(value)) return value[0]?.display_name ?? "—";
  return value?.display_name ?? "—";
}

function partnerName(value: PartnerRecord["partners"]) {
  if (Array.isArray(value)) return value[0]?.name ?? "—";
  return value?.name ?? "—";
}

function actorName(value: ActorProfile) {
  if (Array.isArray(value)) return value[0]?.display_name ?? "مستخدم";
  return value?.display_name ?? "مستخدم";
}

function trackStyle(color: string | null | undefined) {
  return color ? ({ "--track-color": color } as CSSProperties & { "--track-color": string }) : undefined;
}

function canEdit(item: ItemRow | null) {
  return Boolean(item && !item.is_archived);
}

function buildEditable(item: ItemRow, partnerRows: PartnerRecord[]): EditableState {
  return {
    title: item.title,
    track_id: item.track_id?.toString() ?? "",
    idea_type_id: item.idea_type_id?.toString() ?? "",
    caption: item.caption ?? "",
    notes: item.notes ?? "",
    writer_delivery_url: item.writer_delivery_url ?? "",
    production_file_url: item.production_file_url ?? "",
    partnerIds: partnerRows.map((row) => row.partner_id.toString()),
    newPartner: "",
  };
}

function buildAssignments(participants: ParticipantRecord[]): AssignmentState {
  return {
    writer_id: participants.find((row) => row.part === "writer")?.user_id ?? "",
    producer_id: participants.find((row) => row.part === "producer")?.user_id ?? "",
    reviewer_id: participants.find((row) => row.part === "reviewer")?.user_id ?? "",
  };
}

function memberLabel(member: TeamMemberOption) {
  return `${member.display_name} — ${member.email}`;
}

function membersByRole(teamMembers: TeamMemberOption[], role: "writer" | "producer" | "reviewer") {
  return teamMembers
    .filter((member) => member.roles.includes(role))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ar"));
}

function buildItemPayload(editable: EditableState, fields: EditableItemField[]) {
  const payload: Partial<Record<EditableItemField, string | number | null>> = {};
  for (const field of fields) {
    if (field === "track_id" || field === "idea_type_id") {
      payload[field] = editable[field] ? Number(editable[field]) : null;
    } else if (field === "caption" || field === "notes" || field === "writer_delivery_url" || field === "production_file_url") {
      payload[field] = editable[field].trim() ? editable[field] : null;
    } else if (field === "title") {
      payload.title = editable.title;
    }
  }
  return payload;
}

function itemPayloadSignature(payload: Partial<Record<EditableItemField, string | number | null>>) {
  return JSON.stringify({
    title: payload.title ?? null,
    track_id: payload.track_id ?? null,
    idea_type_id: payload.idea_type_id ?? null,
    caption: payload.caption ?? null,
    notes: payload.notes ?? null,
    writer_delivery_url: payload.writer_delivery_url ?? null,
    production_file_url: payload.production_file_url ?? null,
    priority: payload.priority ?? null,
  });
}

function editableSignature(editable: EditableState, fields: EditableItemField[]) {
  return itemPayloadSignature(buildItemPayload(editable, fields));
}

function touchesItemFields(patch: Partial<EditableState>) {
  return itemFieldKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}

function drawerEditableFields(fields: EditableItemField[]) {
  return fields.filter((field) => itemFieldKeySet.has(field));
}

function findTrack(tracks: TrackOption[], item: ItemRow | DrawerPreview | null) {
  return tracks.find((track) => track.id === item?.track_id) ?? null;
}

function findIdeaType(ideaTypes: IdeaTypeOption[], item: ItemRow | DrawerPreview | null) {
  return ideaTypes.find((ideaType) => ideaType.id === item?.idea_type_id) ?? null;
}

export function ItemDrawer({ itemId, initialItem, onClose, onChanged, currentUserId, roles, teamMembers = [], largeCaption }: Props) {
  const { tracks, ideaTypes, partners, refreshReferenceData } = useReferenceData();
  const supabase = useMemo(() => createClient(), []);
  const loadSequence = useRef(0);
  const hasUserEditedFields = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const saveDrainPromiseRef = useRef<Promise<boolean> | null>(null);
  const closeInFlightRef = useRef(false);
  const queuedSaveRef = useRef<SaveOptions | null>(null);
  const latestEditableRef = useRef<EditableState | null>(null);
  const latestItemRef = useRef<ItemRow | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const needsListRefreshRef = useRef(false);
  const actionInFlightRef = useRef(false);
  const confirmDialogRef = useRef<HTMLElement | null>(null);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null);
  const [details, setDetails] = useState<DrawerDetails | null>(null);
  const [editable, setEditable] = useState<EditableState | null>(null);
  const [assignments, setAssignments] = useState<AssignmentState>({ writer_id: "", producer_id: "", reviewer_id: "" });
  const [trackForm, setTrackForm] = useState<TrackState>(emptyTrack);
  const [showTrackForm, setShowTrackForm] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [failedAdvance, setFailedAdvance] = useState<ItemStatus | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [publishPermalink, setPublishPermalink] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [trackSaving, setTrackSaving] = useState(false);
  const [isPending, startTransition] = useTransition();

  const preview = initialItem?.id === itemId ? initialItem : null;
  const item = details?.item ?? null;
  const displayItem = item ?? preview;
  const currentTrack = findTrack(tracks, displayItem);
  const currentIdeaType = findIdeaType(ideaTypes, displayItem);
  const trackName = currentTrack?.name ?? preview?.track_name ?? null;
  const trackColor = currentTrack?.color_hex ?? preview?.track_color ?? null;
  const ideaTypeName = currentIdeaType?.name ?? preview?.idea_type ?? null;
  const isAdmin = isAdminRole(roles);
  const participantParts = details?.participants.filter((row) => row.user_id === currentUserId).map((row) => row.part) ?? [];
  const isProducer = participantParts.includes("producer");
  const permissions = getItemPermissions({
    profile: { active: true, must_change_password: false, roles },
    item: item ? { is_archived: item.is_archived } : null,
    participantParts,
  });
  const saveFieldKeys = drawerEditableFields(permissions.editableFields);
  const hasEditableFields = saveFieldKeys.length > 0;
  const hasProducer = details?.participants.some((row) => row.part === "producer") ?? false;
  const hasApprovalHistory = details?.approvals.some((approval) => approval.result === "approve") ?? false;
  const captionText = item?.caption ?? preview?.caption ?? null;
  const writerDeliveryUrl = item?.writer_delivery_url ?? null;
  const productionFileUrl = item?.production_file_url ?? preview?.production_file_url ?? null;
  const canEditAssignments = isAdmin && teamMembers.length > 0 && canEditItemAssignments(item);
  const writers = useMemo(() => membersByRole(teamMembers, "writer"), [teamMembers]);
  const producers = useMemo(() => membersByRole(teamMembers, "producer"), [teamMembers]);
  const reviewers = useMemo(() => membersByRole(teamMembers, "reviewer"), [teamMembers]);
  const memberById = useMemo(() => new Map(teamMembers.map((member) => [member.id, member])), [teamMembers]);
  const ownerParts = currentOwnerParts(displayItem?.status ?? "idea");
  const currentAssignees = details?.participants
    .filter((row) => ownerParts.includes(row.part))
    .map((row) => profileName(row.profiles))
    .filter((name) => name !== "—") ?? [];
  const currentOwnerLabel = currentAssignees.length
    ? currentAssignees.join("، ")
    : displayItem && ["design_approved", "ready", "published"].includes(displayItem.status) ? "مسؤول النشر" : "غير معيّن";

  useEffect(() => {
    latestItemRef.current = item;
  }, [item]);

  useEffect(() => {
    latestEditableRef.current = editable;
  }, [editable]);

  useEffect(() => () => {
    clearAutoSaveTimer();
    queuedSaveRef.current = null;
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!confirmDialog) return;

    const focusId = window.setTimeout(() => {
      confirmDialogRef.current?.focus();
    }, 0);

    function handleConfirmKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        settleConfirmation(false);
      }
    }

    document.addEventListener("keydown", handleConfirmKeydown);
    return () => {
      window.clearTimeout(focusId);
      document.removeEventListener("keydown", handleConfirmKeydown);
    };
  }, [confirmDialog]);

  useEffect(() => {
    const sequence = ++loadSequence.current;
    const controller = new AbortController();
    let didTimeout = false;

    async function load() {
      if (!itemId) {
        closeInFlightRef.current = false;
        clearAutoSaveTimer();
        queuedSaveRef.current = null;
        latestItemRef.current = null;
        latestEditableRef.current = null;
        lastSavedSignatureRef.current = null;
        needsListRefreshRef.current = false;
        hasUserEditedFields.current = false;
        setDetails(null);
        setEditable(null);
        setAssignments({ writer_id: "", producer_id: "", reviewer_id: "" });
        setTrackForm(emptyTrack);
        setShowTrackForm(false);
        setLoadState("idle");
        setLoadError(null);
        setMessage(null);
        setPublishPermalink("");
        return;
      }

      closeInFlightRef.current = false;
      hasUserEditedFields.current = false;
      clearAutoSaveTimer();
      queuedSaveRef.current = null;
      latestItemRef.current = null;
      latestEditableRef.current = null;
      lastSavedSignatureRef.current = null;
      needsListRefreshRef.current = false;
      setMessage(null);
      setLoadError(null);
      setLoadState("loading");
      setDetails(null);
      setEditable(null);
      setAssignments({ writer_id: "", producer_id: "", reviewer_id: "" });
      setTrackForm(emptyTrack);
      setShowTrackForm(false);
      setFailedAdvance(null);
      setOverrideReason("");
      setRejectNote("");
      setPublishPermalink("");

      const timeoutId = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, detailTimeoutMs);

      try {
        const response = await fetch(`/api/item-details?itemId=${encodeURIComponent(itemId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ItemDetailsResponse;

        if (controller.signal.aborted || sequence !== loadSequence.current) return;

        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error : `HTTP_${response.status}`);
        }

        const nextEditable = buildEditable(payload.details.item, payload.details.partners);
        hasUserEditedFields.current = false;
        latestItemRef.current = payload.details.item;
        latestEditableRef.current = nextEditable;
        lastSavedSignatureRef.current = editableSignature(nextEditable, saveFieldsFor(payload.details.item, payload.details.participants));
        setDetails(payload.details);
        setEditable(nextEditable);
        setAssignments(buildAssignments(payload.details.participants));
        setLoadState("ready");
      } catch (error) {
        if (sequence !== loadSequence.current) return;
        if (controller.signal.aborted && !didTimeout) return;

        setLoadState("error");
        setLoadError(didTimeout ? "تعذر تحميل تفاصيل البطاقة خلال الوقت المتوقع. حاول مجددًا." : extractMessage(error));
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [itemId, retryNonce]);

  function clearAutoSaveTimer() {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }

  function saveFieldsFor(targetItem: ItemRow, participantRows = details?.participants ?? []) {
    const parts = participantRows.filter((row) => row.user_id === currentUserId).map((row) => row.part);
    return drawerEditableFields(getItemPermissions({
      profile: { active: true, must_change_password: false, roles },
      item: { is_archived: targetItem.is_archived },
      participantParts: parts,
    }).editableFields);
  }

  function requestConfirmation(dialog: ConfirmDialog) {
    if (confirmResolverRef.current) return Promise.resolve(false);
    confirmReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmDialog(dialog);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }

  function settleConfirmation(result: boolean) {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolve?.(result);
    window.setTimeout(() => {
      confirmReturnFocusRef.current?.focus();
      confirmReturnFocusRef.current = null;
    }, 0);
  }

  function scheduleAutoSave() {
    const currentItem = latestItemRef.current;
    if (!currentItem || currentItem.is_archived) return;
    clearAutoSaveTimer();
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveFields(false, false);
    }, autoSaveDelayMs);
  }

  function mergeQueuedSave(showMessage: boolean, notifyList: boolean) {
    const current = queuedSaveRef.current;
    queuedSaveRef.current = {
      showMessage: Boolean(current?.showMessage || showMessage),
      notifyList: Boolean(current?.notifyList || notifyList),
    };
  }

  async function runSaveQueue() {
    saveInFlightRef.current = true;
    let didSucceed = true;
    try {
      while (queuedSaveRef.current) {
        const options = queuedSaveRef.current;
        queuedSaveRef.current = null;
        const currentItem = latestItemRef.current;
        const currentEditable = latestEditableRef.current;
        if (!currentItem || !currentEditable || currentItem.is_archived) continue;

        const allowedSaveFields = saveFieldsFor(currentItem);
        if (allowedSaveFields.length === 0) {
          hasUserEditedFields.current = false;
          if (options.showMessage) setMessage("لا تملك صلاحية تعديل حقول هذه المادة.");
          continue;
        }

        const payload = buildItemPayload(currentEditable, allowedSaveFields);
        const signature = itemPayloadSignature(payload);
        if (signature === lastSavedSignatureRef.current) {
          hasUserEditedFields.current = false;
          if (options.showMessage) setMessage("لا توجد تعديلات جديدة.");
          if (options.notifyList && needsListRefreshRef.current) {
            needsListRefreshRef.current = false;
            onChanged?.();
          }
          continue;
        }

        const itemIdAtSave = currentItem.id;
        const response = await fetch(`/api/items/${encodeURIComponent(itemIdAtSave)}/fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "same-origin",
        });
        const result = (await response.json().catch(() => ({}))) as { item?: ItemRow; error?: string };
        if (!response.ok || !result.item) {
          didSucceed = false;
          if (latestItemRef.current?.id === itemIdAtSave) {
            setMessage(result.error ?? itemSaveErrorMessage);
          }
          break;
        }

        if (latestItemRef.current?.id !== itemIdAtSave) continue;

        const savedItem = result.item;
        latestItemRef.current = savedItem;
        lastSavedSignatureRef.current = signature;
        setDetails((current) => current && current.item.id === itemIdAtSave ? { ...current, item: savedItem } : current);

        const latestSignature = latestEditableRef.current ? editableSignature(latestEditableRef.current, allowedSaveFields) : signature;
        if (latestSignature === signature) {
          hasUserEditedFields.current = false;
          if (options.showMessage) setMessage("تم حفظ التعديلات.");
          if (options.notifyList) {
            needsListRefreshRef.current = false;
            onChanged?.();
          } else {
            needsListRefreshRef.current = true;
          }
        } else {
          hasUserEditedFields.current = true;
          mergeQueuedSave(options.showMessage, options.notifyList);
        }
      }
    } finally {
      saveInFlightRef.current = false;
    }
    return didSucceed;
  }

  async function drainSaveQueue() {
    if (saveDrainPromiseRef.current) return saveDrainPromiseRef.current;
    const promise = runSaveQueue().finally(() => {
      saveDrainPromiseRef.current = null;
    });
    saveDrainPromiseRef.current = promise;
    return promise;
  }

  function updateEditable(patch: Partial<EditableState>) {
    const shouldAutoSave = touchesItemFields(patch);
    setEditable((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      latestEditableRef.current = next;
      return next;
    });
    if (shouldAutoSave) {
      hasUserEditedFields.current = true;
      scheduleAutoSave();
    }
  }

  async function reloadAndNotify() {
    if (!itemId) return;
    const { data } = await supabase.from("items").select("*").eq("id", itemId).single();
    if (data) {
      const nextEditable = buildEditable(data, details?.partners ?? []);
      hasUserEditedFields.current = false;
      latestItemRef.current = data;
      latestEditableRef.current = nextEditable;
      lastSavedSignatureRef.current = editableSignature(nextEditable, saveFieldsFor(data, details?.participants ?? []));
      setDetails((current) => current ? { ...current, item: data } : current);
      setEditable((current) => current ? nextEditable : current);
    }
    onChanged?.();
  }

  function refetchDrawerAndList() {
    setRetryNonce((current) => current + 1);
    onChanged?.();
  }

  async function saveFields(showMessage = true, notifyList = showMessage) {
    if (showMessage) clearAutoSaveTimer();
    const currentItem = latestItemRef.current;
    const currentEditable = latestEditableRef.current;
    if (!currentItem || !currentEditable || currentItem.is_archived) return true;
    mergeQueuedSave(showMessage, notifyList);
    return drainSaveQueue();
  }

  function hasUnsavedItemChanges() {
    const currentItem = latestItemRef.current;
    const currentEditable = latestEditableRef.current;
    if (!currentItem || !currentEditable || currentItem.is_archived) return false;
    const allowedSaveFields = saveFieldsFor(currentItem);
    if (allowedSaveFields.length === 0) return false;
    return editableSignature(currentEditable, allowedSaveFields) !== lastSavedSignatureRef.current;
  }

  async function handleClose() {
    if (closeInFlightRef.current) return;
    closeInFlightRef.current = true;
    try {
      clearAutoSaveTimer();
      const hasPendingSave = Boolean(queuedSaveRef.current) || saveInFlightRef.current || Boolean(saveDrainPromiseRef.current);
      if (hasUnsavedItemChanges() || hasPendingSave) {
        mergeQueuedSave(false, true);
        const saved = await drainSaveQueue();
        if (!saved || hasUnsavedItemChanges()) return;
      } else if (needsListRefreshRef.current) {
        needsListRefreshRef.current = false;
        onChanged?.();
      }

      onClose();
    } finally {
      closeInFlightRef.current = false;
    }
  }

  async function savePartners() {
    if (!item || !editable || item.is_archived || !permissions.canManagePartners) return;
    let selectedIds = editable.partnerIds.map(Number);
    const typed = editable.newPartner.trim();
    if (typed) {
      const existing = partners.find((partner) => partner.name === typed);
      if (existing) {
        selectedIds = [...selectedIds, existing.id];
      } else if (await requestConfirmation({ message: "لا يوجد شريك بهذا الاسم، أضِفه؟", confirmLabel: "أضف الشريك", cancelLabel: "إلغاء" })) {
        selectedIds = [...selectedIds];
      } else {
        return;
      }
    }

    const uniqueIds = Array.from(new Set(selectedIds));
    const response = await fetch(`/api/items/${encodeURIComponent(item.id)}/partners`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ partnerIds: uniqueIds, newPartner: typed }),
    });
    const result = (await response.json().catch(() => ({}))) as { partners?: PartnerRecord[]; error?: string };
    if (!response.ok) {
      setMessage(result.error ?? partnersSaveErrorMessage);
      return;
    }

    if (typed) {
      await refreshReferenceData();
    }

    if (result.partners) {
      setDetails((current) => current && current.item.id === item.id ? { ...current, partners: result.partners ?? current.partners } : current);
      setEditable((current) => current ? { ...current, partnerIds: (result.partners ?? []).map((row) => row.partner_id.toString()), newPartner: "" } : current);
    }

    setMessage("تم حفظ الشركاء.");
    onChanged?.();
  }

  async function saveAssignments() {
    if (!item || item.is_archived || !isAdmin || !assignments.writer_id) return;

    const response = await fetch(`/api/admin/items/${encodeURIComponent(item.id)}/participants`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        writer_id: assignments.writer_id,
        producer_id: assignments.producer_id || null,
        reviewer_id: assignments.reviewer_id || null,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { participants?: Pick<ParticipantRecord, "user_id" | "part">[]; error?: string };
    if (!response.ok || !result.participants) {
      setMessage(result.error ?? assignmentsSaveErrorMessage);
      return;
    }

    const nextParticipants: ParticipantRecord[] = result.participants.map((row) => ({
      ...row,
      profiles: { display_name: memberById.get(row.user_id)?.display_name ?? "—" },
    }));
    setDetails((current) => current && current.item.id === item.id ? { ...current, participants: nextParticipants } : current);
    setAssignments(buildAssignments(nextParticipants));
    setMessage("تم حفظ تعيينات الفريق.");
    onChanged?.();
  }

  async function createTrackForDrawer() {
    if (trackSaving || !trackForm.name.trim() || !editable || !isAdmin) return;
    setTrackSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: trackForm.name,
          color_hex: trackForm.color_hex,
          sort_order: trackForm.sort_order ? Number(trackForm.sort_order) : null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { track?: AdminCreatedTrack; error?: string };
      if (!response.ok || !payload.track) {
        setMessage(payload.error ?? "تعذر إنشاء المسار. رمز التشخيص: TRACK_CREATE_DRAWER.");
        return;
      }

      await refreshReferenceData();
      updateEditable({ track_id: payload.track.id.toString() });
      setTrackForm(emptyTrack);
      setShowTrackForm(false);
      setMessage("تمت إضافة المسار واختياره.");
    } finally {
      setTrackSaving(false);
    }
  }

  function runAction(action: () => Promise<unknown>) {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActionBusy(true);
    startTransition(() => {
      void Promise.resolve(action()).finally(() => {
        actionInFlightRef.current = false;
        setActionBusy(false);
      });
    });
  }

  async function advance(toStatus: ItemStatus, override: string | null = null) {
    if (!item) return;
    const { error } = await supabase.rpc("advance_item", {
      p_item: item.id,
      p_to: toStatus,
      p_note: undefined,
      p_override_reason: override ?? undefined,
    });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      setFailedAdvance(toStatus);
      return;
    }
    setFailedAdvance(null);
    setOverrideReason("");
    setMessage("تم تنفيذ الانتقال.");
    await reloadAndNotify();
  }

  async function reject(gate: "content" | "design") {
    if (!item || !rejectNote.trim()) return;
    const { error } = await supabase.rpc("reject_item", {
      p_item: item.id,
      p_gate: gate,
      p_note: rejectNote.trim(),
    });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    setRejectNote("");
    setMessage("تمت الإعادة بالملاحظة.");
    await reloadAndNotify();
  }

  async function assignSlot(slotId: string) {
    if (!item) return;
    const { error } = await supabase.rpc("assign_slot", { p_item: item.id, p_slot: slotId });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    setMessage("تم ربط موعد النشر.");
    await reloadAndNotify();
  }

  async function markPublished() {
    if (!item || !publishPermalink.trim()) return;
    const { error } = await supabase.rpc("mark_published", {
      p_item: item.id,
      p_permalink: publishPermalink.trim(),
      p_at: undefined,
      p_override_reason: undefined,
    });
    if (error) {
      setMessage(parseRuleMessage(extractMessage(error)));
      return;
    }
    setPublishPermalink("");
    setMessage("تم تسجيل النشر.");
    await refetchDrawerAndList();
  }

  function canEditField(field: EditableItemField) {
    return saveFieldKeys.includes(field);
  }

  function copyButton(value: string | null | undefined, label = "نسخ") {
    return value ? <button className="button button-secondary" type="button" onClick={() => navigator.clipboard.writeText(value)}>{label}</button> : null;
  }

  function linkButtons(value: string | null | undefined, openLabel: string) {
    if (!value) return <span>—</span>;
    const href = safeHttpsHref(value);
    if (!href) return <span>رابط غير صالح</span>;
    return (
      <div className="actions-row">
        <a className="button button-secondary" href={href} target="_blank" rel="noopener noreferrer">{openLabel}</a>
        {copyButton(href)}
      </div>
    );
  }

  function readOnlyField(label: string, value: string | null | undefined) {
    return <div className="field"><span>{label}</span><div className="read-box">{value || "—"}</div></div>;
  }

  if (!itemId) return null;

  const drawerDetails = details;
  const performanceData = drawerDetails?.performance ?? null;
  const showDetailsLoading = loadState === "loading";
  const retryButton = loadState === "error" ? <button className="button button-secondary" type="button" onClick={() => setRetryNonce((current) => current + 1)}>إعادة المحاولة</button> : null;
  const actionDisabled = isPending || actionBusy;

  return (
    <div className="veil" onClick={handleClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="بطاقة المادة">
        <button className="icon-button drawer-close" type="button" onClick={handleClose} aria-label="إغلاق">×</button>
        {!displayItem ? (
          <div className="drawer-stack">
            {showDetailsLoading ? <p>جارٍ التحميل...</p> : null}
            {loadError ? <div className="notice stack" role="alert"><p>{loadError}</p>{retryButton}</div> : null}
          </div>
        ) : (
          <div className="drawer-stack">
            <header className="drawer-head">
              <span className="num ref-pill">{displayItem.ref}</span>
              <h2>{displayItem.title}</h2>
              <div className="pill-row">
                <span className="pill status-pill">{workflowLabel(displayItem.status)}</span>
                {trackName ? <span className="pill track-pill" style={trackStyle(trackColor)}>{trackName}</span> : null}
                {ideaTypeName ? <span className="pill">{ideaTypeName}</span> : null}
                {item?.is_archived ? <span className="pill">مؤرشفة</span> : null}
              </div>
              <div className="workflow-meta">
                <span><b>المسؤول الآن:</b> {currentOwnerLabel}</span>
                <span><b>موعد النشر:</b> {drawerDetails?.currentSlot ? formatHebronDateTime(drawerDetails.currentSlot.slot_at) : "غير محدد"}</span>
              </div>
            </header>

            {message && !(isAdmin && failedAdvance) ? <p className="notice">{message}</p> : null}
            {showDetailsLoading ? <p className="muted">جارٍ تحميل التفاصيل والإجراءات...</p> : null}
            {loadError ? <div className="notice stack" role="alert"><p>{loadError}</p>{retryButton}</div> : null}

            {drawerDetails ? (
              <section className="meta-grid">
                <div><span className="meta-label">الشركاء</span><div className="pill-row">{drawerDetails.partners.length ? drawerDetails.partners.map((row) => <span className="pill" key={row.partner_id}>{partnerName(row.partners)}</span>) : <span>—</span>}</div></div>
                <div><span className="meta-label">الفريق</span><div className="pill-row">{drawerDetails.participants.length ? drawerDetails.participants.map((row) => <span className="pill" key={`${row.user_id}-${row.part}`}>{profileName(row.profiles)} · {row.part === "writer" ? "كاتب" : row.part === "producer" ? "منتج" : "مراجع"}</span>) : <span>—</span>}</div></div>
              </section>
            ) : null}

            {item && canEditAssignments ? (
              <details className="drawer-section accordion">
                <summary>تعيينات الفريق</summary>
                <div className="accordion-body stack">
                <p className="muted">هذا القسم للأدمن فقط؛ الحفظ يراجع أدوار الحسابات النشطة داخل قاعدة البيانات.</p>
                <div className="form-grid">
                  <label className="field">الكاتب المسؤول<select className="input" required value={assignments.writer_id} onChange={(event) => setAssignments((current) => ({ ...current, writer_id: event.target.value }))}><option value="">اختر الكاتب</option>{writers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>
                  <label className="field">المنتج المسؤول<select className="input" value={assignments.producer_id} onChange={(event) => setAssignments((current) => ({ ...current, producer_id: event.target.value }))}><option value="">—</option>{producers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>
                </div>
                <label className="field">المراجع المسؤول<select className="input" value={assignments.reviewer_id} onChange={(event) => setAssignments((current) => ({ ...current, reviewer_id: event.target.value }))}><option value="">—</option>{reviewers.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>
                <button className="button button-secondary" type="button" disabled={!assignments.writer_id || actionDisabled} onClick={() => runAction(saveAssignments)}>حفظ التعيينات</button>
                </div>
              </details>
            ) : null}

            <section className="steps" aria-label="تقدم سير العمل">
              {workflowSteps.map((step) => {
                const isDone = isWorkflowStepComplete(displayItem.status, step.key);
                const isCurrent = isWorkflowStepCurrent(displayItem.status, step.key);
                return <span aria-current={isCurrent ? "step" : undefined} className={`step ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`} key={step.key}>{isDone ? "✓ " : ""}{step.label}</span>;
              })}
            </section>

            {item && editable && canEdit(item) ? (
              <details className="drawer-section accordion" open>
                <summary>تفاصيل الفكرة</summary>
                <div className="accordion-body stack">
                <p className="muted">حقول النص للكاتب المعيّن، ورابط الإنتاج للمنتج المعيّن، والشركاء والموعد لمسؤول النشر.</p>
                {canEditField("title") ? <label className="field">العنوان<input className="input" value={editable.title} onChange={(event) => updateEditable({ title: event.target.value })} /></label> : readOnlyField("العنوان", item.title)}
                <div className="form-grid">
                  {canEditField("track_id") ? (
                    <div className="field">
                      <span>المسار</span>
                      <select className="input" value={editable.track_id} onChange={(event) => updateEditable({ track_id: event.target.value })}><option value="">—</option>{tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select>
                      {isAdmin ? <button className="button button-secondary" type="button" disabled={actionDisabled || trackSaving} onClick={() => setShowTrackForm((current) => !current)}>إضافة مسار جديد</button> : null}
                    </div>
                  ) : readOnlyField("المسار", trackName)}
                  {canEditField("idea_type_id") ? <label className="field">نوع الفكرة<select className="input" value={editable.idea_type_id} onChange={(event) => updateEditable({ idea_type_id: event.target.value })}><option value="">—</option>{ideaTypes.map((ideaType) => <option key={ideaType.id} value={ideaType.id}>{ideaType.name}</option>)}</select></label> : readOnlyField("نوع الفكرة", ideaTypeName)}
                </div>
                {showTrackForm && isAdmin ? (
                  <fieldset className="drawer-partners stack">
                    <legend>إضافة مسار جديد</legend>
                    <div className="form-grid">
                      <label className="field">اسم المسار<input className="input" value={trackForm.name} onChange={(event) => setTrackForm((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label className="field">لون المسار<input className="input" type="color" value={trackForm.color_hex} onChange={(event) => setTrackForm((current) => ({ ...current, color_hex: event.target.value }))} /></label>
                    </div>
                    <label className="field">ترتيب العرض<input className="input" inputMode="numeric" value={trackForm.sort_order} onChange={(event) => setTrackForm((current) => ({ ...current, sort_order: event.target.value.replace(/\D/g, "") }))} /></label>
                    <button className="button button-secondary" type="button" disabled={!trackForm.name.trim() || actionDisabled || trackSaving} onClick={() => runAction(createTrackForDrawer)}>حفظ المسار</button>
                  </fieldset>
                ) : null}
                {hasApprovalHistory ? <p className="soft-banner">هذا النص معتمَد — تعديله لا يُلغي الاعتماد تلقائياً. أبلغ المراجع إن كان التغيير جوهرياً.</p> : null}
                {canEditField("caption") ? <label className="field">الكابشن<textarea className={`input textarea ${largeCaption ? "textarea-large" : ""}`} value={editable.caption} onChange={(event) => updateEditable({ caption: event.target.value })} /></label> : readOnlyField("الكابشن", item.caption)}
                {canEditField("notes") ? <label className="field">الملاحظات<textarea className="input textarea" value={editable.notes} onChange={(event) => updateEditable({ notes: event.target.value })} /></label> : readOnlyField("الملاحظات", item.notes)}
                {canEditField("writer_delivery_url") ? (
                  <label className="field">رابط تسليم الكاتب<input className="input" value={editable.writer_delivery_url} onChange={(event) => updateEditable({ writer_delivery_url: event.target.value })} /></label>
                ) : (
                  <div className="field"><span>رابط تسليم الكاتب</span>{linkButtons(writerDeliveryUrl, "فتح رابط التسليم")}</div>
                )}
                {canEditField("production_file_url") ? (
                  <label className="field">رابط ملف الإنتاج<input className="input" value={editable.production_file_url} onChange={(event) => updateEditable({ production_file_url: event.target.value })} /></label>
                ) : (
                  <div className="field"><span>رابط ملف الإنتاج</span>{linkButtons(productionFileUrl, "فتح ملف الإنتاج")}</div>
                )}
                {hasEditableFields ? <button className="button" type="button" disabled={actionDisabled} onClick={() => runAction(() => saveFields(true))}>حفظ التعديلات</button> : null}
                {permissions.canManagePartners ? (
                  <fieldset className="drawer-partners">
                    <legend>الشركاء</legend>
                    <div className="drawer-partner-checks">
                      {partners.map((partner) => <label className="drawer-partner-option" key={partner.id}><input type="checkbox" checked={editable.partnerIds.includes(partner.id.toString())} onChange={(event) => updateEditable({ partnerIds: event.target.checked ? [...editable.partnerIds, partner.id.toString()] : editable.partnerIds.filter((id) => id !== partner.id.toString()) })} /> <span>{partner.name}</span></label>)}
                    </div>
                    <div className="drawer-new-partner stack">
                      <label className="field">شريك جديد<input className="input" value={editable.newPartner} onChange={(event) => updateEditable({ newPartner: event.target.value })} /></label>
                      <button className="button button-secondary" type="button" disabled={actionDisabled} onClick={() => runAction(savePartners)}>حفظ الشركاء</button>
                    </div>
                  </fieldset>
                ) : null}
                </div>
              </details>
            ) : null}

            <details className="drawer-section accordion" open={displayItem.status === "writing"}>
              <summary>المحتوى <span className="section-status">{contentStateLabel(displayItem.status)}</span></summary>
              <div className="accordion-body stack">
              <div className="read-box">{captionText || "—"}</div>
              <button className="button button-secondary" type="button" onClick={() => navigator.clipboard.writeText(captionText ?? "")}>نسخ الكابشن</button>
              {item?.notes ? <p>{item.notes}</p> : null}
              <div className="actions-row">
                {writerDeliveryUrl ? linkButtons(writerDeliveryUrl, "فتح رابط التسليم") : null}
                {productionFileUrl ? linkButtons(productionFileUrl, "فتح ملف الإنتاج") : null}
                {item?.ig_permalink ? <a className="button button-secondary" href={item.ig_permalink} target="_blank" rel="noopener noreferrer">فتح المنشور</a> : null}
                {item?.ig_permalink ? copyButton(item.ig_permalink) : null}
              </div>
              </div>
            </details>

            {drawerDetails ? (
              <details className="drawer-section accordion" open={displayItem.status === "writing" || displayItem.status === "in_production"}>
                <summary>الاعتمادات <span className="section-status">{drawerDetails.approvals.length.toLocaleString("en-US")}</span></summary>
                <div className="accordion-body stack">
                  {drawerDetails.approvals.length ? drawerDetails.approvals.map((approval) => (
                    <article className="history-entry" key={approval.id}>
                      <b>{approval.gate === "content" ? "اعتماد المحتوى" : "اعتماد الإنتاج"} · {approval.result === "approve" ? "مقبول" : "مُعاد"}</b>
                      <span>{actorName(approval.profiles)} · {formatHebronDateTime(approval.created_at)}</span>
                      {approval.note ? <p>{approval.note}</p> : null}
                    </article>
                  )) : <p className="muted">لا توجد قرارات اعتماد بعد.</p>}
                </div>
              </details>
            ) : null}

            <details className="drawer-section accordion" open={displayItem.status === "content_approved" || displayItem.status === "in_production"}>
              <summary>الإنتاج <span className="section-status">{productionStateLabel(displayItem.status)}</span></summary>
              <div className="accordion-body stack">
                <p><b>المنتج:</b> {drawerDetails?.participants.filter((row) => row.part === "producer").map((row) => profileName(row.profiles)).join("، ") || "غير معيّن"}</p>
                <div className="field"><span>ملف الإنتاج</span>{linkButtons(productionFileUrl, "فتح ملف الإنتاج")}</div>
              </div>
            </details>

            <details className="drawer-section accordion" open={displayItem.status === "design_approved" || displayItem.status === "ready" || displayItem.status === "published"}>
              <summary>النشر</summary>
              <div className="accordion-body stack">
                {permissions.canAssignSlot && item?.status !== "published" ? (
                  <label className="field">موعد النشر<select className="input" value={item?.slot_id ?? ""} disabled={actionDisabled} onChange={(event) => event.target.value && runAction(() => assignSlot(event.target.value))}><option value="">اختر موعدًا</option>{drawerDetails?.currentSlot ? <option value={drawerDetails.currentSlot.id}>{formatHebronDateTime(drawerDetails.currentSlot.slot_at)}</option> : null}{drawerDetails?.openSlots.filter((slot) => slot.slot_id && slot.slot_id !== item?.slot_id).map((slot) => <option key={slot.slot_id ?? ""} value={slot.slot_id ?? ""}>{formatHebronDateTime(slot.slot_at)} · {(slot.n_items ?? 0).toLocaleString("en-US")}</option>)}</select></label>
                ) : <p><b>الموعد:</b> {drawerDetails?.currentSlot ? formatHebronDateTime(drawerDetails.currentSlot.slot_at) : "غير محدد"}</p>}
                <div><b>الشركاء:</b> {drawerDetails?.partners.length ? drawerDetails.partners.map((row) => partnerName(row.partners)).join("، ") : "—"}</div>
                {item?.ig_permalink ? <div className="actions-row"><a className="button button-secondary" href={item.ig_permalink} target="_blank" rel="noopener noreferrer">فتح المنشور</a>{copyButton(item.ig_permalink)}</div> : null}
              </div>
            </details>

            {drawerDetails ? (
              <details className="drawer-section accordion">
                <summary>السجل <span className="section-status">{drawerDetails.transitions.length.toLocaleString("en-US")}</span></summary>
                <div className="accordion-body history-list">
                  {drawerDetails.transitions.length ? drawerDetails.transitions.map((transition) => (
                    <article className="history-entry" key={transition.id}>
                      <b>{transition.from_status ? workflowLabel(transition.from_status) : "إنشاء"} ← {workflowLabel(transition.to_status)}</b>
                      <span>{actorName(transition.profiles)} · {formatHebronDateTime(transition.created_at)}</span>
                      {transition.note ? <p>{transition.note}</p> : null}
                      {transition.is_override ? <p className="override-note">تجاوز إداري: {transition.override_reason || "—"}</p> : null}
                    </article>
                  )) : <p className="muted">لا توجد انتقالات مسجلة بعد.</p>}
                </div>
              </details>
            ) : null}

            {item?.status === "published" && performanceData ? (
              <section className="drawer-section stack">
                <h3>الأداء</h3>
                {performanceData.signal_partial ? <p className="soft-banner">قياس ناقص</p> : null}
                <div className="metric-grid">
                  <span>الوصول <b className="num">{formatNumber(performanceData.reach)}</b></span>
                  <span>الحفظ <b className="num">{formatPercent(performanceData.save_rate)}</b></span>
                  <span>المشاركة <b className="num">{formatPercent(performanceData.share_rate)}</b></span>
                  <span>المتابعة <b className="num">{formatPercent(performanceData.follow_rate)}</b></span>
                </div>
              </section>
            ) : null}

            {item && editable && !item.is_archived ? (
              <section className="drawer-section stack">
                <h3>الإجراءات</h3>
                {item.status === "idea" && permissions.canSubmitWriting ? <button className="button" type="button" disabled={actionDisabled} onClick={() => runAction(async () => { if (await requestConfirmation({ message: "متأكد أنك جاهز لإرسال المسودة لاعتماد المحتوى؟", confirmLabel: "إرسال", cancelLabel: "إلغاء" })) await advance("writing"); })}>إرسال لاعتماد المحتوى</button> : null}
                {item.status === "writing" && permissions.canReview ? (
                  <>
                    <button className="button" type="button" disabled={actionDisabled} onClick={() => runAction(() => advance("content_approved"))}>اعتماد المحتوى</button>
                    <label className="field">ملاحظة الإعادة<textarea className="input textarea" placeholder="هذه الملاحظة هي ما سيراه الكاتب." value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} /></label>
                    <button className="button button-secondary" type="button" disabled={!rejectNote.trim() || actionDisabled} onClick={() => runAction(() => reject("content"))}>إعادة للكاتب مع السبب</button>
                  </>
                ) : item.status === "writing" ? <p className="muted">بانتظار مراجع.</p> : null}
                {item.status === "content_approved" && permissions.canStartProduction ? hasProducer ? <button className="button" type="button" disabled={actionDisabled} onClick={() => runAction(() => advance("in_production"))}>تسليم للإنتاج</button> : <p className="muted">بانتظار تعيين منتج.</p> : null}
                {item.status === "in_production" && permissions.canReview ? (
                  <>
                    <button className="button" type="button" disabled={actionDisabled} onClick={() => runAction(() => advance("design_approved"))}>اعتماد الإنتاج</button>
                    <label className="field">ملاحظة الإعادة<textarea className="input textarea" placeholder="هذه الملاحظة هي ما سيراه المنتج." value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} /></label>
                    <button className="button button-secondary" type="button" disabled={!rejectNote.trim() || actionDisabled} onClick={() => runAction(() => reject("design"))}>إعادة بملاحظة</button>
                  </>
                ) : item.status === "in_production" ? <p className="muted">{isProducer ? "بانتظار مراجع." : "بانتظار الإنتاج والمراجعة."}</p> : null}
                {item.status === "design_approved" && permissions.canMoveReady ? <button className="button" type="button" disabled={actionDisabled} onClick={() => runAction(() => advance("ready"))}>جاهزة للنشر</button> : null}
                {item.status === "ready" && permissions.canMarkPublished ? <><label className="field">رابط منشور إنستغرام<input className="input" inputMode="url" placeholder="https://www.instagram.com/p/..." value={publishPermalink} onChange={(event) => setPublishPermalink(event.target.value)} /></label><button className="button" type="button" disabled={!safeHttpsHref(publishPermalink) || actionDisabled} onClick={() => runAction(markPublished)}>تم النشر</button></> : item.status === "ready" ? <p className="muted">بانتظار مسؤول النشر.</p> : null}
                {isAdmin && failedAdvance ? (
                  <div className="override-box">
                    <p className="eyebrow">تجاوز إداري</p>
                    {message ? <div className="notice stack" role="alert"><span>سبب المنع</span><span>{message}</span></div> : null}
                    <label className="field">سبب التجاوز<input className="input" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
                    <button className="button" type="button" disabled={!overrideReason.trim() || actionDisabled} onClick={() => runAction(() => advance(failedAdvance, overrideReason.trim()))}>تجاوز ونفّذ</button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <p className="muted">الحالة الحالية: {statusLabels[displayItem.status]}</p>
          </div>
        )}
        {confirmDialog ? (
          <div className="veil" onClick={(event) => { event.stopPropagation(); settleConfirmation(false); }}>
            <section
              aria-describedby="item-drawer-confirm-description"
              aria-labelledby="item-drawer-confirm-title"
              aria-modal="true"
              className="confirm-panel stack"
              onClick={(event) => event.stopPropagation()}
              ref={confirmDialogRef}
              role="dialog"
              tabIndex={-1}
            >
              <h2 id="item-drawer-confirm-title">تأكيد الإجراء</h2>
              <p id="item-drawer-confirm-description">{confirmDialog.message}</p>
              <div className="actions-row">
                <button className="button" type="button" onClick={() => settleConfirmation(true)}>{confirmDialog.confirmLabel}</button>
                <button className="button button-secondary" type="button" onClick={() => settleConfirmation(false)}>{confirmDialog.cancelLabel}</button>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
