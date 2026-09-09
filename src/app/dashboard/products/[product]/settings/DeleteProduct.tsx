"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductRef } from "@/lib/merchant";
import { deleteProductAction } from "./settingsActions";

/**
 * Deleting a product, gated on typing its name.
 *
 * The name is checked again in the action, so this only decides when the
 * button lights up. A dialog whose confirm button is live from the moment it
 * opens is one misclick from a year of commission history.
 */

export function DeleteProduct({ product, name }: { product: ProductRef; name: string }) {
  const [typed, setTyped] = useState("");
  const matches = typed === name;

  return (
    <AlertDialog onOpenChange={(open) => !open && setTyped("")}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm">Delete this product and everything in it</p>
          <p className="text-sm text-muted-foreground">
            Affiliates, links, clicks and commissions go with it. There is no undo.
          </p>
        </div>
        <AlertDialogTrigger
          render={<Button variant="destructive" size="sm" className="cursor-pointer" />}
        >
          Delete
        </AlertDialogTrigger>
      </div>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Every affiliate, link, click and commission on this product is deleted with it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form action={deleteProductAction.bind(null, product)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">Type {name} to confirm</Label>
            <Input
              id="confirm"
              name="confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" className="cursor-pointer" disabled={!matches}>
              Delete product
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
