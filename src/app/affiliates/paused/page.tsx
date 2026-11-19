import { notFound, redirect } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CenteredShell } from "@/components/CenteredShell";
import { requestHost } from "@/lib/requestHost";
import { productOnHost } from "../merchantOnHost";

/** Where every affiliate page and action sends a visitor while the product is not served. */
export default async function ProgramPausedPage() {
  const { merchant, served } = await productOnHost(await requestHost());
  if (!merchant) notFound();
  if (served) redirect("/affiliates");

  return (
    <CenteredShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">This affiliate program is paused</CardTitle>
          <CardDescription>Check back later.</CardDescription>
        </CardHeader>
      </Card>
    </CenteredShell>
  );
}
