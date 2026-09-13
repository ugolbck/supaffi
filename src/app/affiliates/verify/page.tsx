import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyAffiliateLogin } from "./verifyAffiliateLogin";

/**
 * Where the emailed login link lands.
 *
 * Opening the link does not log anyone in; pressing the button does. Mail
 * scanners such as Outlook Safe Links open every link in a message before the
 * recipient does, and a link that logged in on open would be spent by the time
 * the Affiliate clicked it. It would also let anyone who gets a victim to open
 * a link sign them in as someone else. The button posts through a server
 * action, which Next only accepts from this same site.
 */
export default async function AffiliateVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !token) {
    redirect("/affiliates/login?error=missing_token");
  }

  return (
    <main className="mx-auto flex max-w-md flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Continue to your affiliate dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={verifyAffiliateLogin} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="cursor-pointer">
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
