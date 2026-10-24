import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** What a closed program's signup link shows instead of a form. */
export function InviteOnly({ merchantName, programName }: { merchantName: string; programName: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Invite only</CardTitle>
        <CardDescription>
          {merchantName}, {programName} program
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full cursor-pointer" render={<Link href="/affiliates/login" />}>
          Log in
        </Button>
      </CardContent>
    </Card>
  );
}
