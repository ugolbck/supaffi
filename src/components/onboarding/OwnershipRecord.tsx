import { Term } from "@/components/Term";
import { dnsRecordName } from "@/lib/onboarding";
import { RecordTable } from "./RecordTable";

/**
 * The TXT record that proves a product's domain is the Owner's, for the
 * subdomain step and the product settings. The name is shown relative to the
 * zone, like the A record's.
 */
export function OwnershipRecordTitle() {
  return (
    <>
      Add this <Term tip="A text entry in your DNS. This one proves the domain is yours.">TXT record</Term> to verify it
    </>
  );
}

export function OwnershipRecordTable({ record }: { record: { name: string; value: string } }) {
  return (
    <RecordTable
      records={[
        { label: "Type", value: "TXT", badge: true, copyable: false },
        { label: "Name", value: dnsRecordName(record.name) },
        { label: "Value", value: record.value },
      ]}
    />
  );
}
