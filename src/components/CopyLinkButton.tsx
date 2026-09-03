"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyLinkButton({
  link,
  size = "default",
  label = "Copy link",
}: {
  link: string;
  size?: "sm" | "default";
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      className="cursor-pointer"
      onClick={() => {
        navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
