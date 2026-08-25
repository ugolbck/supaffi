import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MerchantForm } from "./MerchantForm";
import { createMerchantAction } from "./createMerchant";

export default async function NewMerchantPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main>
      <h1>Connect a Merchant</h1>
      <MerchantForm action={createMerchantAction} credentialsRequired />
    </main>
  );
}
