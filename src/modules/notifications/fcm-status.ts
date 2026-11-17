export type FcmRuntimeStatus = 'ready' | 'disabled';

let status: FcmRuntimeStatus = 'disabled';

export const setFcmRuntimeStatus = (value: FcmRuntimeStatus): void => {
  status = value;
};

export const fcmRuntimeStatus = (): FcmRuntimeStatus => status;
