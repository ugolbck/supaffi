import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[12px] border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,box-shadow,filter,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] cursor-pointer outline-none select-none active:not-aria-[haspopup]:translate-y-[2px] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Every raised variant reads the same physical story: top-lit
        // gradient fill, 1px white inset highlight on the top edge, layered
        // drop shadow underneath. Hover raises it (bigger, softer shadow);
        // active kills the drop shadow and swaps in an inset so the button
        // visibly sinks into the surface rather than only scaling down.
        // The lit band is confined to the top ~45% rather than running the
        // whole height — spread over the full button it stops reading as a
        // highlight and just looks like a washed-out fill.
        default:
          "bg-primary text-primary-foreground [background-image:linear-gradient(180deg,color-mix(in_oklch,var(--primary),white_13%)_0%,var(--primary)_45%)] shadow-[var(--edge-crisp),var(--shadow-primary)] hover:[background-image:linear-gradient(180deg,color-mix(in_oklch,var(--primary),white_22%)_0%,color-mix(in_oklch,var(--primary),white_5%)_45%)] hover:shadow-[var(--edge-crisp),var(--shadow-primary-hover)] active:shadow-[var(--edge-crisp),var(--shadow-primary-pressed)]",
        outline:
          "border-border bg-elevated [background-image:var(--elevated-surface)] shadow-[var(--edge-light),0_1px_1px_hsl(var(--shadow-color)/0.05),0_2px_4px_-2px_hsl(var(--shadow-color)/0.06)] hover:bg-muted hover:text-foreground hover:shadow-[var(--edge-light),0_1px_1px_hsl(var(--shadow-color)/0.06),0_4px_8px_-2px_hsl(var(--shadow-color)/0.10),0_8px_16px_-6px_hsl(var(--shadow-color)/0.08)] active:shadow-[var(--edge-pressed)] aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground [background-image:linear-gradient(180deg,#ffffff_0%,var(--secondary)_100%)] shadow-[var(--edge-light),0_1px_1px_hsl(var(--shadow-color)/0.04),0_2px_4px_-2px_hsl(var(--shadow-color)/0.05)] hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] hover:shadow-[var(--edge-light),0_1px_1px_hsl(var(--shadow-color)/0.05),0_3px_6px_-2px_hsl(var(--shadow-color)/0.08)] active:shadow-[var(--edge-pressed)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
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
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
