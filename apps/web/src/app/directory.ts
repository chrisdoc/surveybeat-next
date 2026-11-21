import { Nav, Popover } from "@foldkit/ui";
import { Predicate } from "effect";
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html";
import { message } from "../messages/locale.ts";
import { downloadPersonalDataView, pageShell, signOutView } from "./components.ts";
import type { Child } from "./components.ts";
import { historyHref, settingsHref, teamsHref } from "./routes.ts";
import type { NavSection, ShellHeader } from "./directoryModel.ts";

export {
  LoadedTeams,
  LoadedTeam,
  LoadedSettings,
  LoadedFailedEmails,
  FailedEmailResend,
  FAILED_EMAIL_POLL_INTERVAL,
  FAILED_EMAIL_MAX_POLLS,
  failedEmailKeepsPolling,
  roleName,
  decodeName,
  decodeZone,
  decodeEmail,
  decodeSize,
  decodePerson,
} from "./directoryModel.ts";

export type {
  NavSection,
  ShellHeader,
  AttentionItem,
  ChecklistStep,
  OffboardingForm,
} from "./directoryModel.ts";

export { teamsScreenView, teamScreenView } from "./directoryTeam.ts";

export { settingsScreenView } from "./directorySettings.ts";

const sectionHref = (section: NavSection): string => {
  switch (section) {
    case "teams": {
      return teamsHref();
    }

    case "history": {
      return historyHref();
    }

    case "settings": {
      return settingsHref();
    }
  }
};

const sectionNav = <Message>(
  config: {
    readonly sections: readonly NavSection[];
    readonly current: NavSection | null;
    readonly className: string;
    readonly linkClass: (isCurrent: boolean) => string;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Nav.view<NavSection>({
    items: config.sections,
    ariaLabel: message("nav.label"),
    toHref: (section) => sectionHref(section),
    isItemCurrent: (section) => section === config.current,
    toView: ({ nav, items }) =>
      h.nav(
        [...nav, h.Class(config.className)],
        items.map((item) =>
          h.a([...item.link, h.Class(config.linkClass(item.isCurrent))], [message(`nav.${item.value}`)]),
        ),
      ),
  });

const desktopLinkClass = (isCurrent: boolean): string =>
  `inline-flex min-h-11 items-center rounded-control px-3 transition-colors ${
    isCurrent
      ? "bg-primary-soft font-semibold text-primary"
      : "font-medium text-muted hover:bg-subtle hover:text-ink"
  }`;

const phoneLinkClass = (isCurrent: boolean): string =>
  `flex min-h-11 items-center rounded-control px-3 ${
    isCurrent ? "bg-primary-soft font-semibold text-primary" : "font-medium text-ink hover:bg-subtle"
  }`;

const menuPanelClass =
  "z-50 w-[min(20rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-4 shadow-raised";

const chevronIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [h.Width("16"), h.Height("16"), h.ViewBox("0 0 16 16"), h.AriaHidden(true), h.Class("shrink-0")],
    [
      h.path([
        h.D("M4 6l4 4 4-4"),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.8"),
        h.StrokeLinecap("round"),
        h.StrokeLinejoin("round"),
      ]),
    ],
  );

const hamburgerIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [h.Width("18"), h.Height("18"), h.ViewBox("0 0 18 18"), h.AriaHidden(true), h.Class("shrink-0")],
    [
      h.path([
        h.D("M3 5h12M3 9h12M3 13h12"),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.8"),
        h.StrokeLinecap("round"),
      ]),
    ],
  );

const headerMenu = <Message>(
  model: Popover.Model,
  toParentMessage: (message: Popover.Message) => Message,
  parts: {
    readonly button: (attributes: readonly ChildAttribute[]) => Html;
    readonly panel: (attributes: readonly ChildAttribute[]) => Html;
  },
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.id,
    model,
    view: Popover.view,
    viewInputs: {
      anchor: { placement: "bottom-end", gap: 8 },
      toView: ({ button, panel, isVisible }) =>
        h.div(
          [h.Class("relative")],
          [parts.button(button), isVisible ? parts.panel(panel) : null].filter(Predicate.isNotNull),
        ),
    },
    toParentMessage,
  });

export const shellView = <Message>(
  header: ShellHeader<Message>,
  children: readonly Child[],
  h: HtmlBuilder<Message>,
  wide = false,
): Html => {
  const sections: readonly NavSection[] = header.organizationAdmin
    ? ["teams", "history", "settings"]
    : ["teams", "history"];

  const accountButton = (attributes: readonly ChildAttribute[]): Html =>
    h.button(
      [
        ...attributes,
        h.Class(
          "inline-flex min-h-11 max-w-[16rem] items-center gap-2 rounded-control border border-line bg-surface px-3 text-[15px] font-semibold text-ink shadow-card transition-colors hover:bg-subtle",
        ),
      ],
      [
        h.span([h.Class("min-w-0 truncate")], [header.organizationName]),

        " ",
        h.span([h.Class("sr-only")], [message("account.menu")]),
        chevronIcon(h),
      ],
    );

  const accountPanel = (attributes: readonly ChildAttribute[]): Html =>
    h.div(
      [...attributes, h.Class(menuPanelClass)],
      [h.div([h.Class("flex flex-col gap-3")], [downloadPersonalDataView(h, true), signOutView(h, true)])],
    );

  const menuButton = (attributes: readonly ChildAttribute[]): Html =>
    h.button(
      [
        ...attributes,
        h.Class(
          "inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle",
        ),
      ],
      [hamburgerIcon(h), message("nav.menu")],
    );

  const navPanel = (attributes: readonly ChildAttribute[]): Html =>
    h.div(
      [...attributes, h.Class(`${menuPanelClass} max-h-[calc(100vh-6rem)] overflow-y-auto`)],
      [
        sectionNav(
          { sections, current: header.section, className: "flex flex-col gap-1", linkClass: phoneLinkClass },
          h,
        ),
        h.div(
          [h.Class("mt-4 flex flex-col gap-3 border-t border-line-soft pt-4")],
          [
            h.p([h.Class("break-words text-sm font-semibold text-muted")], [header.organizationName]),
            downloadPersonalDataView(h, true),
            signOutView(h, true),
          ],
        ),
      ],
    );

  return pageShell(
    {
      wide,
      privacyCurrent: header.privacyCurrent,
      header: [
        sectionNav(
          {
            sections,
            current: header.section,
            className: "hidden min-w-0 items-center gap-x-1 text-[15px] lg:flex",
            linkClass: desktopLinkClass,
          },
          h,
        ),
        h.div(
          [h.Class("ml-auto hidden lg:block")],
          [
            headerMenu(
              header.accountMenu,
              header.onAccountMenu,
              { button: accountButton, panel: accountPanel },
              h,
            ),
          ],
        ),
        h.div(
          [h.Class("ml-auto lg:hidden")],
          [headerMenu(header.navMenu, header.onNavMenu, { button: menuButton, panel: navPanel }, h)],
        ),
      ],
    },
    children,
    h,
  );
};
