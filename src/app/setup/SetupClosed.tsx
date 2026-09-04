import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SetupClosed() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Setup is closed</CardTitle>
        <CardDescription>
          This instance did not issue a setup token at startup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Check the server logs, then restart the instance to issue a new one.
        </p>
      </CardContent>
    </Card>
  );
}
