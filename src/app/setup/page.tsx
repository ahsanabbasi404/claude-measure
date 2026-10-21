import { Suspense } from "react";
import SetupView from "@/components/dashboard/setup-view";

export default function Page() {
  return (
    <Suspense>
      <SetupView />
    </Suspense>
  );
}
