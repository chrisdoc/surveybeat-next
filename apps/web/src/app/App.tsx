import { Button } from "@base-ui/react/button";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import type { OrganizationSummary } from "@surveybeat/domain";
import { type ReactNode, useEffect, useState } from "react";
import { message } from "../messages/index.ts";
import { SettingsScreen, Shell, TeamScreen, TeamsScreen, useRoute } from "./Directory.tsx";
import { PulseScreen, PulsesScreen } from "./Pulses.tsx";
import { chooseOrganization, createOrganization, loadSession, type View } from "./session.ts";

const buttonClass = "rounded bg-black px-4 py-2 text-white disabled:opacity-50";

function Screen({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

/** A plain form POST, so the browser follows the redirect to WorkOS's logout. */
function SignOut() {
  return (
    <form method="post" action="/auth/logout" className="mt-6">
      <Button type="submit" className="text-sm text-gray-600 underline">
        {message("signOut.action")}
      </Button>
    </form>
  );
}

function SignIn() {
  const failed = new URLSearchParams(window.location.search).get("signin") === "failed";
  return (
    <Screen title={message("signIn.title")}>
      <p className="mt-2 text-gray-600">{message("signIn.intro")}</p>
      {failed ? (
        <p role="alert" className="mt-2 text-red-700">
          {message("signIn.failed")}
        </p>
      ) : null}
      <Button
        render={<a href="/auth/login" />}
        nativeButton={false}
        className={`mt-4 inline-block ${buttonClass}`}
      >
        {message("signIn.action")}
      </Button>
    </Screen>
  );
}

function CreateOrganization({ onDone }: { readonly onDone: (view: View) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Screen title={message("createOrganization.title")}>
      <p className="mt-2 text-gray-600">{message("createOrganization.intro")}</p>
      <Form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void createOrganization(name.trim()).then(onDone);
        }}
      >
        <Field.Root>
          <Field.Label className="block text-sm font-medium">
            {message("createOrganization.name")}
          </Field.Label>
          <Field.Control
            required
            maxLength={100}
            value={name}
            onValueChange={setName}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </Field.Root>
        <Button type="submit" disabled={busy || name.trim() === ""} className={buttonClass}>
          {message("createOrganization.action")}
        </Button>
      </Form>
      <SignOut />
    </Screen>
  );
}

function ChooseOrganization({
  organizations,
  onDone,
}: {
  readonly organizations: ReadonlyArray<OrganizationSummary>;
  readonly onDone: (view: View) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Screen title={message("chooseOrganization.title")}>
      <p className="mt-2 text-gray-600">{message("chooseOrganization.intro")}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {organizations.map((organization) => (
          <li key={organization.id}>
            <Button
              disabled={busy}
              className={`w-full text-left ${buttonClass}`}
              onClick={() => {
                setBusy(true);
                void chooseOrganization(organization.id).then(onDone);
              }}
            >
              {organization.name}
            </Button>
          </li>
        ))}
      </ul>
      <SignOut />
    </Screen>
  );
}

/** Teams, a Team, or the Organization settings, by the URL hash. */
function SignedIn({
  organization,
  organizationAdmin,
}: {
  readonly organization: string;
  readonly organizationAdmin: boolean;
}) {
  const route = useRoute();
  return (
    <Shell
      title={message("signedIn.title", { organization })}
      organizationAdmin={organizationAdmin}
      signOut={<SignOut />}
    >
      {route._tag === "Team" ? (
        <TeamScreen key={route.id} id={route.id} />
      ) : route._tag === "Pulses" ? (
        <PulsesScreen key={route.teamId} teamId={route.teamId} />
      ) : route._tag === "Pulse" ? (
        <PulseScreen key={route.pulseId} teamId={route.teamId} pulseId={route.pulseId} />
      ) : route._tag === "Settings" && organizationAdmin ? (
        <SettingsScreen />
      ) : (
        <TeamsScreen organizationAdmin={organizationAdmin} />
      )}
    </Shell>
  );
}

/** The app entry: the sign-in screens until a session is in an Organization. */
export function App() {
  const [view, setView] = useState<View | undefined>(undefined);
  useEffect(() => {
    void loadSession().then(setView);
  }, []);

  if (view === undefined) return <Screen title={message("app.loading")} />;
  switch (view._tag) {
    case "SignedOut":
      return <SignIn />;
    case "Failed":
      return (
        <Screen title={message("app.error")}>
          <Button className={`mt-4 ${buttonClass}`} onClick={() => void loadSession().then(setView)}>
            {message("app.retry")}
          </Button>
        </Screen>
      );
    case "CreateOrganization":
      return <CreateOrganization onDone={setView} />;
    case "NotInOrganization":
      return (
        <Screen title={message("notInOrganization.title")}>
          <p className="mt-2 text-gray-600">{message("notInOrganization.intro")}</p>
          <SignOut />
        </Screen>
      );
    case "ChooseOrganization":
      return <ChooseOrganization organizations={view.organizations} onDone={setView} />;
    case "SignedIn":
      return <SignedIn organization={view.organization.name} organizationAdmin={view.organizationAdmin} />;
  }
}
