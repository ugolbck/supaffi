import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-(--radius) border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,translate,scale,box-shadow,filter,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] cursor-pointer outline-none select-none active:not-aria-[haspopup]:scale-[0.97] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // No border. The base 1px transparent border let the page show
        // through as a white ring, and an inset bevel is drawn from the
        // padding edge, so any border at all leaves a dark 1px band outside
        // the lit line and the bevel reads as an outline. Focus keeps the
        // ring. Depth is a bevel and a cast shadow in the fill's hue; hover
        // is a sheen that fades in over the centre, drawn by ::before so
        // opacity is the only thing animating; press drops the button 1px
        // and takes the cast shadow away, no scale. Secondary carries a real
        // fill and a real border so it stays visible on the white cards.
        default:
          "relative isolate border-0 bg-primary text-primary-foreground shadow-[var(--shadow-button)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[image:var(--sheen-primary)] before:opacity-0 before:transition-opacity before:duration-700 before:ease-[cubic-bezier(0.23,1,0.32,1)] hover:shadow-[var(--shadow-button-hover)] hover:before:opacity-100 active:not-aria-[haspopup]:scale-100 active:translate-y-px active:shadow-[var(--shadow-button-pressed)] active:before:opacity-100 motion-reduce:active:translate-y-0",
        outline:
          "border-border bg-elevated [background-image:var(--elevated-surface)] shadow-[var(--edge-light),0_1px_1px_hsl(var(--shadow-color)/0.05),0_2px_4px_-2px_hsl(var(--shadow-color)/0.06)] hover:bg-muted hover:text-foreground hover:shadow-[var(--edge-light),0_1px_1px_hsl(var(--shadow-color)/0.06),0_4px_8px_-2px_hsl(var(--shadow-color)/0.10),0_8px_16px_-6px_hsl(var(--shadow-color)/0.08)] active:shadow-[var(--edge-pressed)] aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "border-neutral-300 bg-neutral-100 text-foreground shadow-xs hover:border-neutral-400 hover:bg-neutral-200 active:bg-neutral-200 active:shadow-none aria-expanded:bg-neutral-200",
        ghost:
          "hover:bg-neutral-200/80 hover:text-foreground aria-expanded:bg-neutral-200/80 aria-expanded:text-foreground",
        // The one green in the system. Reserved for the moment something has
        // genuinely succeeded, which is why it is not just primary recoloured.
        success:
          "bg-status-success text-white shadow-[var(--shadow-success)] hover:bg-[color-mix(in_oklch,var(--status-success),black_8%)] hover:shadow-[var(--shadow-success-hover)] active:shadow-none",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
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
