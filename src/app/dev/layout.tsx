import { notFound } from "next/navigation";
import type { ReactNode } from "react";

// The dev kit renders every screen with fixture data so a change can be
// looked at without a database. It is a workbench, not a page anyone should
// reach on a deployed instance.
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
