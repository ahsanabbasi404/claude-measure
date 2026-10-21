import { Suspense } from "react";
import PeoplePage from "@/components/dashboard/people";

export default function Page() {
  return (
    <Suspense>
      <PeoplePage />
    </Suspense>
  );
}
