export function sanitisePageView<T extends { type: string; url: string }>(
  event: T,
): T | null {
  if (event.type !== "pageview") return null;
  try {
    const url = new URL(event.url);
    if (
      !["surveytool.io", "www.surveytool.io"].includes(url.hostname) ||
      url.pathname.startsWith("/auth") ||
      url.pathname.startsWith("/dashboard")
    )
      return null;
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
