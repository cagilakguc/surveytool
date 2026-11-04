export const usageTools = [
  "landxml",
  "csv_dxf",
  "jxl_dxf",
  "coordinates",
  "gis",
  "terrain",
  "asbuilt",
  "sections",
  "surface_compare",
  "pavement",
] as const;
export const usageActions = [
  "import_complete",
  "export_prepared",
  "calculate_complete",
  "preview_mode",
  "demo_open",
] as const;
export type UsageTool = (typeof usageTools)[number];
export type UsageAction = (typeof usageActions)[number];
export type UsageDetails = {
  source?: "upload" | "demo" | "saved_project";
  format?:
    | "xml"
    | "jxl"
    | "dxf"
    | "pdf"
    | "csv"
    | "txt"
    | "kml"
    | "geojson"
    | "shapefile"
    | "geopackage"
    | "xlsx";
  mode?: "plan" | "map" | "3d";
};
export type UsageConsent = "allow" | "deny" | "unknown";
const consentKey = "surveytool-usage-consent-v1";
let memoryConsent: UsageConsent = "unknown";
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export function makeUsageEvent(
  tool: UsageTool,
  action: UsageAction,
  details: UsageDetails = {},
) {
  if (
    !(usageTools as readonly string[]).includes(tool) ||
    !(usageActions as readonly string[]).includes(action)
  )
    return null;
  const params: Record<string, string> = { tool, action };
  if (["upload", "demo", "saved_project"].includes(details.source ?? ""))
    params.source = details.source!;
  if (
    [
      "xml",
      "jxl",
      "dxf",
      "pdf",
      "csv",
      "txt",
      "kml",
      "geojson",
      "shapefile",
      "geopackage",
      "xlsx",
    ].includes(details.format ?? "")
  )
    params.format = details.format!;
  if (["plan", "map", "3d"].includes(details.mode ?? ""))
    params.mode = details.mode!;
  return { name: tool + "_" + action, params };
}

export function analyticsPrivacyAllowed() {
  if (typeof navigator === "undefined") return false;
  return (
    navigator.doNotTrack !== "1" &&
    !(navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl
  );
}
export function usageMeasurementId() {
  const id = import.meta.env?.VITE_GA_MEASUREMENT_ID?.trim() ?? "";
  return /^G-[A-Z0-9]{4,20}$/.test(id) ? id : "";
}
export function usageEnvironmentAllowed() {
  return (
    typeof window !== "undefined" &&
    import.meta.env?.PROD === true &&
    ["surveytool.io", "www.surveytool.io"].includes(window.location.hostname) &&
    navigator.onLine &&
    analyticsPrivacyAllowed()
  );
}
export function getUsageConsent(): UsageConsent {
  if (!analyticsPrivacyAllowed()) return "deny";
  try {
    const saved = localStorage.getItem(consentKey);
    if (saved === "allow" || saved === "deny") return saved;
  } catch {
    /* Browser storage is optional. */
  }
  return memoryConsent;
}
export function setUsageConsent(consent: "allow" | "deny") {
  memoryConsent = consent;
  try {
    localStorage.setItem(consentKey, consent);
  } catch {
    /* Keep this tab's choice. */
  }
  const id = usageMeasurementId();
  const win = window as AnalyticsWindow;
  Reflect.set(win, "ga-disable-" + id, consent === "deny");
  win.gtag?.("consent", "update", {
    analytics_storage: consent === "allow" ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  if (consent === "deny")
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0].trim();
      if (/^_ga(?:_|$)/.test(name))
        document.cookie = name + "=; Max-Age=0; Path=/; Secure; SameSite=Lax";
    }
}
export function startUsageAnalytics() {
  const id = usageMeasurementId();
  if (!id || !usageEnvironmentAllowed() || getUsageConsent() !== "allow")
    return false;
  const win = window as AnalyticsWindow;
  Reflect.set(win, "ga-disable-" + id, false);
  if (document.getElementById("surveytool-usage-tag")) return true;
  win.dataLayer ??= [];
  win.gtag = (...args: unknown[]) => {
    win.dataLayer!.push(args);
  };
  win.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  win.gtag("js", new Date());
  win.gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_domain: "none",
    cookie_expires: 86400,
    page_location: window.location.origin + window.location.pathname,
    page_referrer: "",
  });
  const script = document.createElement("script");
  script.id = "surveytool-usage-tag";
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  document.head.appendChild(script);
  return true;
}
export function trackToolAction(
  tool: UsageTool,
  action: UsageAction,
  details: UsageDetails = {},
) {
  const event = makeUsageEvent(tool, action, details);
  if (!event || !startUsageAnalytics()) return;
  (window as AnalyticsWindow).gtag?.("event", event.name, {
    ...event.params,
    page_location: window.location.origin + window.location.pathname,
    page_referrer: "",
  });
}
