const instagramPermalinkPattern = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[^/?#]+/;

export function isInstagramPermalink(value: string) {
  return instagramPermalinkPattern.test(value.trim());
}

export function createSingleFlight() {
  let isRunning = false;

  return async function runOnce<T>(operation: () => Promise<T>) {
    if (isRunning) return { started: false as const };

    isRunning = true;
    try {
      return { started: true as const, value: await operation() };
    } finally {
      isRunning = false;
    }
  };
}
