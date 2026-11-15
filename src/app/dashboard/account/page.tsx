import { Fragment } from "react";
import { requireOwnerSession } from "@/app/requireOwner";
import { availableUpdate, installedVersion, updateCheckEnabled } from "@/lib/version";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { EmailForm, PasswordForm } from "./AccountForms";
import { ext } from "@/extensions";
import { staticExt } from "@/extensions/static";

/**
 * The account itself, and the instance it runs on.
 *
 * The instance block is read only. Whether this server checks for releases is
 * a server setting, and nothing here can apply an update: that would mean
 * giving the web app control of Docker on the host. The wireframe's toggle is
 * corrected to a line of status and the environment variable that changes it.
 */

export default async function AccountPage() {
  // Open to an Owner refused by owners.canUse, so the session alone.
  const { ownerId, email } = await requireOwnerSession();

  // Answers from the cache and starts a refresh it does not wait for, so a
  // server with no outbound access does not pay for this on every visit.
  const update = availableUpdate();
  const sections = await ext.account.sections(ownerId);

  return (
    <Page>
      <PageTitle title="Account" />

      <EmailForm email={email} />
      <PasswordForm />

      {sections.map((section, i) => (
        <Fragment key={i}>{section}</Fragment>
      ))}

      {staticExt.instance.showInfo && (
        <Section title="This instance">
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span>Supaffi {installedVersion()}</span>
              <span className="text-muted-foreground">
                {update ? (
                  <a
                    className="cursor-pointer underline"
                    href={update.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {update.version} is out
                  </a>
                ) : (
                  "up to date"
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Update check</span>
              <span className="text-muted-foreground">
                {updateCheckEnabled() ? "on. Set SUPAFFI_UPDATE_CHECK=off on the server to turn it off." : "off"}
              </span>
            </div>
          </div>
        </Section>
      )}
    </Page>
  );
}
