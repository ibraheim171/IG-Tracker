export type ReadyPublishDialogState = {
  permalink: string;
  message: string | null;
  overrideReason: string;
  blocked: boolean;
};

export function resetReadyPublishDialogState(): ReadyPublishDialogState {
  return {
    permalink: "",
    message: null,
    overrideReason: "",
    blocked: false,
  };
}
