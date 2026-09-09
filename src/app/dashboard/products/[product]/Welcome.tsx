import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { dismissWelcomeAction } from "./dismissWelcomeAction";

/**
 * The last frame of onboarding, carried over to the product's own screen.
 *
 * Onboarding ends with a link and nobody on the other end of it. Every number
 * on this page reads zero until somebody signs up, so the banner keeps the one
 * action that changes that in front of the Owner until they either recruit an
 * affiliate or dismiss it.
 */
export function Welcome({
  product,
  link,
}: {
  product: { id: string; slug: string };
  link: string;
}) {
  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-accent-200 bg-accent-50 p-5">
      <form action={dismissWelcomeAction.bind(null, product)} className="absolute top-3 right-3">
        <Button type="submit" variant="ghost" size="sm" className="cursor-pointer" aria-label="Dismiss">
          <X className="size-4" />
        </Button>
      </form>
      <p className="text-sm font-medium">Your program is live.</p>
      <p className="text-sm text-muted-foreground">Nobody has joined yet. Share your link, then come back here.</p>
      <code className="break-all font-mono text-xs">{link}</code>
      <div className="flex gap-2">
        <CopyLinkButton link={link} size="sm" label="Copy link" />
        <Button variant="ghost" size="sm" className="cursor-pointer" render={<a href={link} target="_blank" rel="noreferrer" />}>
          Preview what they see
        </Button>
      </div>
    </div>
  );
}
