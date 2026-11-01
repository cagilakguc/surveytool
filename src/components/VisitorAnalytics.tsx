import { lazy, Suspense } from "react";
import { sanitisePageView } from "../lib/visitorAnalytics";
const Analytics = lazy(() =>
  import("@vercel/analytics/react").then((m) => ({ default: m.Analytics })),
);
export default function VisitorAnalytics() {
  if (
    !import.meta.env.PROD ||
    !["surveytool.io", "www.surveytool.io"].includes(window.location.hostname)
  )
    return null;
  return (
    <Suspense fallback={null}>
      <Analytics
        mode="production"
        beforeSend={(event) =>
          navigator.onLine ? sanitisePageView(event) : null
        }
      />
    </Suspense>
  );
}
