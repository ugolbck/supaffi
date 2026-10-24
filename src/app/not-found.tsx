import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CenteredShell } from "@/components/CenteredShell";

export default function NotFound() {
  return (
    <CenteredShell>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Page not found</CardTitle>
          <CardDescription>This address doesn&apos;t lead anywhere.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full cursor-pointer" render={<Link href="/" />}>
            Go home
          </Button>
        </CardContent>
      </Card>
    </CenteredShell>
  );
}
