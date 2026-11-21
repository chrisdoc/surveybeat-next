import { EmailAddress, Policy } from "@surveybeat/domain";
import { Option } from "effect";
import { absurd } from "effect/Function";
import type { Update } from "foldkit";
import { message as translate } from "../messages/locale.ts";
import type { Model, Message } from "./appModel.ts";
import {
  LoadSession,
  SendSignInCode,
  VerifySignInCode,
  SignInWithPasskey,
  ListPasskeysCmd,
  CreateOrganization,
  ChooseOrganization,
  Navigate,
  LoadExternalUrl,
  loadActiveRouteCommand,
} from "./appCommands.ts";
import { foldNavMenu, foldAccountMenu, closeHeaderMenus } from "./appNav.ts";
import { urlToAppRoute } from "./routes.ts";

type SessionMessage = Extract<
  Message,
  {
    _tag:
      | "UrlRequested"
      | "UrlChanged"
      | "Navigated"
      | "GotSession"
      | "RetrySession"
      | "GotPasskeyCapabilities"
      | "SignInWithPasskeyClicked"
      | "PasskeySignedIn"
      | "SignInEmailChanged"
      | "SignInCodeChanged"
      | "SubmitSignInEmail"
      | "SubmitSignInCode"
      | "SignInCodeSent"
      | "SignInCodeChecked"
      | "CreateOrgNameChanged"
      | "SubmitCreateOrg"
      | "ChooseOrgClicked"
      | "GotNavMenuMessage"
      | "GotAccountMenuMessage";
  }
>;

export const updateSession = (model: Model, message: SessionMessage): Update.Return<Model, Message> => {
  switch (message._tag) {
    case "UrlRequested": {
      const { request } = message;

      if (request._tag === "Internal") {
        const path =
          request.url.pathname + (Option.isSome(request.url.search) ? `?${request.url.search.value}` : "");

        if (request.url.pathname.startsWith("/auth/")) {
          return {
            model,
            commands: [LoadExternalUrl({ href: path })],
          };
        }

        return {
          model,
          commands: [Navigate({ url: path })],
        };
      }

      return {
        model,
        commands: [LoadExternalUrl({ href: request.href })],
      };
    }

    case "UrlChanged": {
      const route = urlToAppRoute(message.url);

      const nextModel: Model = {
        ...model,
        url: message.url,
        route,
        teamDetail: { _tag: "Loading" },
        teamOverview: { _tag: "Loading" },
        history: { _tag: "Loading" },
        pulses: { _tag: "Loading" },
        homePulses: {},
        homeRounds: {},
        homeActions: {},
        pulseDetail: { _tag: "Loading" },
        testSendBusy: false,
        testSendResult: Option.none(),
        settings: { _tag: "Loading" },
        failedEmails: { _tag: "Loading" },
        failedEmailResends: {},
        teams: { _tag: "Loading" },
        results: { _tag: "Loading" },
        guideCopy: "idle",
        shareBusy: false,
        shareFailure: Option.none(),
        retryBusy: false,
        retryFailure: Option.none(),
        rounds: { _tag: "Loading" },
        roundDetails: {},
        roundRates: {},
        roundConfirm: Option.none(),
        roundsSkipDate: "",
        roundsBusy: false,
        roundsFailure: Option.none(),
        actions: { _tag: "Loading" },
        actionTitle: "",
        actionOwnerId: Option.none(),
        actionDueDate: "",
        actionDimension: "none",
        actionBusy: false,
        actionFailure: Option.none(),
        roundNote: { _tag: "Loading" },
        noteDraft: "",
        noteEditing: false,
        noteBusy: false,
        noteFailure: Option.none(),
        passkeySignInBusy: false,
        passkeys: {
          ...model.passkeys,
          ...(route._tag === "Privacy" &&
          (model.session._tag === "SignedIn" ||
            model.session._tag === "CreateOrganization" ||
            model.session._tag === "NotInOrganization")
            ? { list: { _tag: "Loading" } }
            : {}),
          notice: null,
          failure: Option.none(),
          editingId: Option.none(),
          editingName: "",
          pendingDeleteId: Option.none(),
        },
      };

      const closed = closeHeaderMenus(nextModel);

      if (model.session._tag === "SignedIn") {
        return {
          model: closed.model,
          commands: [...(closed.commands ?? []), ...loadActiveRouteCommand(route)],
        };
      }

      if (
        route._tag === "Privacy" &&
        (model.session._tag === "CreateOrganization" || model.session._tag === "NotInOrganization")
      ) {
        return {
          model: closed.model,
          commands: [...(closed.commands ?? []), ListPasskeysCmd()],
        };
      }

      return closed;
    }

    case "Navigated": {
      return { model };
    }

    case "GotSession": {
      const sessionResult = message.result;
      const failedParam = Option.isSome(model.url.search) && model.url.search.value.includes("signin=failed");

      switch (sessionResult._tag) {
        case "SignedOut": {
          return {
            model: {
              ...model,
              session: {
                _tag: "SignedOut",
                failed: failedParam,
                stage: "email",
                email: "",
                code: "",
                busy: false,
                notice: null,
              },
            },
          };
        }

        case "Failed": {
          return {
            model: {
              ...model,
              session: { _tag: "Failed" },
            },
          };
        }

        case "CreateOrganization": {
          const loadingPasskeys = model.route._tag === "Privacy";

          return {
            model: {
              ...model,
              passkeySignInBusy: false,
              session: { _tag: "CreateOrganization", name: "", busy: false },
              ...(loadingPasskeys ? { passkeys: { ...model.passkeys, list: { _tag: "Loading" } } } : {}),
            },
            ...(loadingPasskeys ? { commands: [ListPasskeysCmd()] } : {}),
          };
        }

        case "ChooseOrganization": {
          return {
            model: {
              ...model,
              passkeySignInBusy: false,
              session: {
                _tag: "ChooseOrganization",
                organizations: sessionResult.organizations,
                busy: false,
              },
            },
          };
        }

        case "SignedIn": {
          const nextModel: Model = {
            ...model,
            passkeySignInBusy: false,
            session: {
              _tag: "SignedIn",
              organization: sessionResult.organization,
              organizationAdmin: sessionResult.organizationAdmin,
              locale: sessionResult.locale,
              detectedLocale: sessionResult.detectedLocale,
              organizationLocale: sessionResult.organizationLocale,
            },
            ...(model.route._tag === "Privacy"
              ? { passkeys: { ...model.passkeys, list: { _tag: "Loading" } } }
              : {}),
          };

          return { model: nextModel, commands: loadActiveRouteCommand(model.route) };
        }

        case "NotInOrganization": {
          const loadingPasskeys = model.route._tag === "Privacy";

          return {
            model: {
              ...model,
              passkeySignInBusy: false,
              session: { _tag: "NotInOrganization" },
              ...(loadingPasskeys ? { passkeys: { ...model.passkeys, list: { _tag: "Loading" } } } : {}),
            },
            ...(loadingPasskeys ? { commands: [ListPasskeysCmd()] } : {}),
          };
        }
      }

      return absurd(sessionResult);
    }

    case "RetrySession": {
      return {
        model: { ...model, session: { _tag: "Loading" } },
        commands: [LoadSession()],
      };
    }

    case "GotPasskeyCapabilities": {
      return {
        model: { ...model, passkeyCapabilities: message.capabilities },
      };
    }

    case "SignInWithPasskeyClicked": {
      if (
        model.session._tag !== "SignedOut" ||
        model.session.busy ||
        model.passkeySignInBusy ||
        !model.passkeyCapabilities.supported
      ) {
        return { model };
      }

      return {
        model: {
          ...model,
          passkeySignInBusy: true,
          session: { ...model.session, notice: null },
        },
        commands: [SignInWithPasskey()],
      };
    }

    case "PasskeySignedIn": {
      if (model.session._tag !== "SignedOut") {
        return { model: { ...model, passkeySignInBusy: false } };
      }

      if (message.verified) {
        return {
          model: { ...model, passkeySignInBusy: false, session: { ...model.session, notice: null } },
          commands: [LoadSession()],
        };
      }

      return {
        model: {
          ...model,
          passkeySignInBusy: false,
          session: { ...model.session, notice: translate("signIn.passkeyFailed") },
        },
      };
    }

    case "SignInEmailChanged": {
      return model.session._tag === "SignedOut"
        ? { model: { ...model, session: { ...model.session, email: message.email } } }
        : { model };
    }

    case "SignInCodeChanged": {
      return model.session._tag === "SignedOut"
        ? { model: { ...model, session: { ...model.session, code: message.code } } }
        : { model };
    }

    case "SubmitSignInEmail": {
      if (model.session._tag !== "SignedOut" || model.session.busy) {
        return { model };
      }

      if (model.session.email.trim() === "") {
        return { model };
      }

      return {
        model: { ...model, session: { ...model.session, busy: true, notice: null } },
        commands: [SendSignInCode({ email: EmailAddress.make(model.session.email.trim()) })],
      };
    }

    case "SubmitSignInCode": {
      if (model.session._tag !== "SignedOut" || model.session.busy) {
        return { model };
      }

      if (model.session.code.trim() === "") {
        return { model };
      }

      return {
        model: { ...model, session: { ...model.session, busy: true, notice: null } },
        commands: [
          VerifySignInCode({
            email: EmailAddress.make(model.session.email.trim()),
            code: model.session.code.trim(),
          }),
        ],
      };
    }

    case "SignInCodeSent": {
      if (model.session._tag !== "SignedOut") {
        return { model };
      }

      return {
        model: {
          ...model,
          session: {
            ...model.session,
            busy: false,
            stage: message.sent ? "code" : model.session.stage,
            code: "",
            notice: message.sent
              ? translate("signIn.sent", {
                  email: model.session.email.trim(),
                  digits: Policy.signIn.codeDigits,
                  minutes: Policy.signIn.codeMinutes,
                })
              : translate("signIn.sendFailed"),
          },
        },
      };
    }

    case "SignInCodeChecked": {
      if (model.session._tag !== "SignedOut") {
        return { model };
      }

      if (message.verified) {
        return {
          model: { ...model, session: { ...model.session, busy: false, notice: null } },
          commands: [LoadSession()],
        };
      }

      return {
        model: {
          ...model,
          session: { ...model.session, busy: false, notice: translate("signIn.failed") },
        },
      };
    }

    case "CreateOrgNameChanged": {
      if (model.session._tag === "CreateOrganization") {
        return {
          model: {
            ...model,
            session: { ...model.session, name: message.name },
          },
        };
      }

      return { model };
    }

    case "SubmitCreateOrg": {
      if (model.session._tag === "CreateOrganization") {
        const name = model.session.name.trim();

        if (name === "") {
          return { model };
        }

        return {
          model: {
            ...model,
            session: { ...model.session, busy: true },
          },
          commands: [CreateOrganization({ name })],
        };
      }

      return { model };
    }

    case "ChooseOrgClicked": {
      if (model.session._tag === "ChooseOrganization") {
        return {
          model: {
            ...model,
            session: { ...model.session, busy: true },
          },
          commands: [ChooseOrganization({ organizationId: message.organizationId })],
        };
      }

      return { model };
    }

    case "GotNavMenuMessage": {
      return foldNavMenu(model, message.message);
    }

    case "GotAccountMenuMessage": {
      return foldAccountMenu(model, message.message);
    }
  }
};
