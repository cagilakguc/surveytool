export type OfflineAvailability = { ready: boolean; updateReady: boolean };
export async function offlineAvailability(): Promise<OfflineAvailability> {
  if (!("serviceWorker" in navigator))
    return { ready: false, updateReady: false };
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) return { ready: false, updateReady: false };
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve({ ready, updateReady: !!registration.waiting });
    };
    const timeout = window.setTimeout(() => finish(false), 2000);
    channel.port1.onmessage = (event) => finish(event.data?.ready === true);
    registration.active!.postMessage({ type: "SURVEYTOOL_OFFLINE_STATUS" }, [
      channel.port2,
    ]);
  });
}

export async function protectProjectStorage() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
