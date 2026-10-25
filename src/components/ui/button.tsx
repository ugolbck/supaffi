import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-(--radius) border border-transparent text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] cursor-pointer outline-none select-none active:not-aria-[haspopup]:scale-[0.97] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Flat fills. The edge is the fill itself or a hairline, never a
        // shadow; hover changes one colour step, press scales down.
        default: "border-0 bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border-border bg-white text-foreground hover:border-neutral-300 hover:bg-neutral-50 aria-expanded:border-neutral-300 aria-expanded:bg-neutral-50",
        secondary:
          "border-border bg-neutral-100 text-foreground hover:border-neutral-300 hover:bg-neutral-200 aria-expanded:bg-neutral-200",
        ghost:
          "hover:bg-neutral-100 hover:text-foreground aria-expanded:bg-neutral-100 aria-expanded:text-foreground",
        // The one green in the system. Reserved for the moment something has
        // genuinely succeeded, which is why it is not just primary recoloured.
        success:
          "bg-status-success text-white hover:bg-[color-mix(in_oklch,var(--status-success),black_8%)]",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      // Base UI assumes it renders a real <button> and warns on every render
      // when it does not. Every `render` here is a link — a step's Continue,
      // an "open Stripe" — so the default follows the element actually being
      // rendered instead of leaving eleven call sites to remember a prop.
      nativeButton={nativeButton ?? render === undefined}
      render={render}
      {...props}
    />
  )
}

export { Button, buttonVariants }
