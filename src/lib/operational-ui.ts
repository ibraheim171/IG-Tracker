const instagramPermalinkPattern = /^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?(?:[?#]\S*)?$/;

export function isInstagramPermalink(value: string) {
  return instagramPermalinkPattern.test(value.trim());
}

export async function executeInstagramPublish<T>(permalink: string, publish: (normalizedPermalink: string) => PromiseLike<T>) {
  const normalizedPermalink = permalink.trim();
  if (!isInstagramPermalink(normalizedPermalink)) return { started: false as const };
  return { started: true as const, value: await publish(normalizedPermalink) };
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
