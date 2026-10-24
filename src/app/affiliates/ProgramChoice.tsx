import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** The entry page when a product has more than one program open to signups. */
export function ProgramChoice({
  merchantName,
  programs,
}: {
  merchantName: string;
  programs: { slug: string; name: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join</CardTitle>
        <CardDescription>{merchantName} affiliate programs</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {programs.map((program) => (
          <Button
            key={program.slug}
            variant="outline"
            className="w-full cursor-pointer"
            render={<Link href={`/affiliates/signup/${program.slug}`} />}
          >
            {program.name}
          </Button>
        ))}
        <p className="mt-2 text-center text-[13px] text-muted-foreground">
          Already signed up?{" "}
          <Link href="/affiliates/login" className="cursor-pointer font-medium text-foreground underline underline-offset-2">
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
