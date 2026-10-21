import { Suspense } from "react";
import ActivityPage from "@/components/dashboard/activity";

export default function Page() {
  return (
    <Suspense>
      <ActivityPage />
    </Suspense>
  );
}
