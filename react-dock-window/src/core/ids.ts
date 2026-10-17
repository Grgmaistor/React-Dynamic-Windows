let counter = 0;

/** Fresh unique id for a group, split or window (`prefix-<time>-<counter>`). */
export const createId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;
