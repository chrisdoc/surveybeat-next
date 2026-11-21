import * as DateTime from "effect/DateTime";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import type { Failure } from "./api.ts";

export const PasskeyCapabilities = Schema.Struct({
  supported: Schema.Boolean,
  conditionalGet: Schema.Boolean,
  platformAuthenticator: Schema.Boolean,
});

export type PasskeyCapabilities = typeof PasskeyCapabilities.Type;

export const defaultPasskeyCapabilities: PasskeyCapabilities = {
  supported: false,
  conditionalGet: false,
  platformAuthenticator: false,
};

export const PasskeyItem = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  credentialID: Schema.String,
  deviceType: Schema.String,
  backedUp: Schema.Boolean,
  createdAt: Schema.NullOr(Schema.String),
  aaguid: Schema.NullOr(Schema.String),
});

export type PasskeyItem = typeof PasskeyItem.Type;

const RawPasskeyItem = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  credentialID: Schema.String,
  deviceType: Schema.String,
  backedUp: Schema.Union([Schema.Boolean, Schema.Finite]),
  createdAt: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  aaguid: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawPasskeyList = Schema.Array(RawPasskeyItem);

const ErrorPayload = Schema.Struct({
  code: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawDescriptor = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("public-key"),
  transports: Schema.optional(Schema.Array(Schema.String)),
});

const RawRequestOptions = Schema.Struct({
  challenge: Schema.String,
  rpId: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Finite),
  userVerification: Schema.optional(Schema.Literals(["required", "preferred", "discouraged"])),
  allowCredentials: Schema.optional(Schema.Array(RawDescriptor)),
});

const RawCreationOptions = Schema.Struct({
  challenge: Schema.String,
  rp: Schema.Struct({
    name: Schema.String,
    id: Schema.optional(Schema.String),
  }),
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
  }),
  pubKeyCredParams: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("public-key"),
      alg: Schema.Finite,
    }),
  ),
  timeout: Schema.optional(Schema.Finite),
  excludeCredentials: Schema.optional(Schema.Array(RawDescriptor)),
  authenticatorSelection: Schema.optional(
    Schema.Struct({
      authenticatorAttachment: Schema.optional(Schema.Literals(["platform", "cross-platform"])),
      residentKey: Schema.optional(Schema.Literals(["required", "preferred", "discouraged"])),
      requireResidentKey: Schema.optional(Schema.Boolean),
      userVerification: Schema.optional(Schema.Literals(["required", "preferred", "discouraged"])),
    }),
  ),
  attestation: Schema.optional(Schema.Literals(["none", "indirect", "direct", "enterprise"])),
});

const EncodedIdPayload = Schema.Struct({
  id: Schema.optional(Schema.String),
});

const ANONYMOUS_AAGUID = "00000000-0000-0000-0000-000000000000";

const COMMON_AUTHENTICATOR_NAMES: Readonly<Record<string, string>> = {
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "Apple Passwords",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain (Managed)",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b78a0a55-6ef8-d246-a042-ba0f6d55050c": "LastPass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

export const aaguidProviderName = (aaguid: string | null): string | null => {
  const normalized = aaguid?.trim().toLowerCase();

  if (normalized === undefined || normalized === "" || normalized === ANONYMOUS_AAGUID) {
    return null;
  }

  return COMMON_AUTHENTICATOR_NAMES[normalized] ?? null;
};

export const isValidBase64Url = (value: string): boolean =>
  value.length > 0 && value.length % 4 !== 1 && /^[A-Za-z0-9_-]+$/.test(value);

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }

  return bytes;
};

const toBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const toTransport = (value: string): AuthenticatorTransport | null => {
  switch (value) {
    case "ble":
    case "hybrid":
    case "internal":
    case "nfc":
    case "usb": {
      return value;
    }

    default: {
      return null;
    }
  }
};

const toDescriptor = (item: typeof RawDescriptor.Type): PublicKeyCredentialDescriptor => {
  const transports = (item.transports ?? [])
    .map(toTransport)
    .filter((entry): entry is AuthenticatorTransport => entry !== null);

  return {
    type: item.type,
    id: fromBase64Url(item.id),
    ...(transports.length > 0 ? { transports } : {}),
  };
};

const parseRequestOptions = (options: typeof RawRequestOptions.Type): PublicKeyCredentialRequestOptions => {
  if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function") {
    return PublicKeyCredential.parseRequestOptionsFromJSON({
      challenge: options.challenge,
      ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      ...(options.userVerification === undefined ? {} : { userVerification: options.userVerification }),
      ...(options.allowCredentials === undefined
        ? {}
        : {
            allowCredentials: options.allowCredentials.map((item) => ({
              id: item.id,
              type: item.type,
              ...(item.transports === undefined ? {} : { transports: [...item.transports] }),
            })),
          }),
    });
  }

  return {
    challenge: fromBase64Url(options.challenge),
    ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.userVerification === undefined ? {} : { userVerification: options.userVerification }),
    ...(options.allowCredentials === undefined
      ? {}
      : { allowCredentials: options.allowCredentials.map(toDescriptor) }),
  };
};

const toAuthenticatorSelection = (
  selection: NonNullable<typeof RawCreationOptions.Type.authenticatorSelection>,
): AuthenticatorSelectionCriteria => ({
  ...(selection.authenticatorAttachment === undefined
    ? {}
    : { authenticatorAttachment: selection.authenticatorAttachment }),
  ...(selection.residentKey === undefined ? {} : { residentKey: selection.residentKey }),
  ...(selection.requireResidentKey === undefined ? {} : { requireResidentKey: selection.requireResidentKey }),
  ...(selection.userVerification === undefined ? {} : { userVerification: selection.userVerification }),
});

const parseCreationOptions = (
  options: typeof RawCreationOptions.Type,
): PublicKeyCredentialCreationOptions => {
  if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function") {
    return PublicKeyCredential.parseCreationOptionsFromJSON({
      challenge: options.challenge,
      rp: {
        name: options.rp.name,
        ...(options.rp.id === undefined ? {} : { id: options.rp.id }),
      },
      user: {
        id: options.user.id,
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams.map((param) => ({
        type: param.type,
        alg: param.alg,
      })),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      ...(options.excludeCredentials === undefined
        ? {}
        : {
            excludeCredentials: options.excludeCredentials.map((item) => ({
              id: item.id,
              type: item.type,
              ...(item.transports === undefined ? {} : { transports: [...item.transports] }),
            })),
          }),
      ...(options.authenticatorSelection === undefined
        ? {}
        : { authenticatorSelection: toAuthenticatorSelection(options.authenticatorSelection) }),
      ...(options.attestation === undefined ? {} : { attestation: options.attestation }),
    });
  }

  return {
    challenge: fromBase64Url(options.challenge),
    rp: {
      name: options.rp.name,
      ...(options.rp.id === undefined ? {} : { id: options.rp.id }),
    },
    user: {
      id: fromBase64Url(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams.map((param) => ({
      type: param.type,
      alg: param.alg,
    })),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.excludeCredentials === undefined
      ? {}
      : { excludeCredentials: options.excludeCredentials.map(toDescriptor) }),
    ...(options.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: toAuthenticatorSelection(options.authenticatorSelection) }),
    ...(options.attestation === undefined ? {} : { attestation: options.attestation }),
  };
};

const serializeCredential = (credential: PublicKeyCredential): unknown => {
  if (typeof credential.toJSON === "function") {
    return credential.toJSON();
  }

  if (credential.response instanceof AuthenticatorAssertionResponse) {
    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: toBase64Url(credential.response.clientDataJSON),
        authenticatorData: toBase64Url(credential.response.authenticatorData),
        signature: toBase64Url(credential.response.signature),
        ...(credential.response.userHandle === null
          ? {}
          : { userHandle: toBase64Url(credential.response.userHandle) }),
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }

  if (credential.response instanceof AuthenticatorAttestationResponse) {
    const transports =
      typeof credential.response.getTransports === "function" ? credential.response.getTransports() : [];

    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
      response: {
        clientDataJSON: toBase64Url(credential.response.clientDataJSON),
        attestationObject: toBase64Url(credential.response.attestationObject),
        transports,
      },
      clientExtensionResults: credential.getClientExtensionResults(),
    };
  }

  return null;
};

const signalUnknownCredentialSafe = (rpId: string | undefined, credentialId: string | undefined) =>
  Effect.gen(function* () {
    if (
      typeof PublicKeyCredential === "undefined" ||
      typeof PublicKeyCredential.signalUnknownCredential !== "function" ||
      rpId === undefined ||
      rpId === "" ||
      credentialId === undefined ||
      !isValidBase64Url(credentialId)
    ) {
      return;
    }

    yield* Effect.tryPromise({
      try: () => PublicKeyCredential.signalUnknownCredential({ rpId, credentialId }),
      catch: String,
    }).pipe(Effect.catch((error) => Effect.logWarning(`signalUnknownCredential sync warning: ${error}`)));
  });

const errorNameOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "name" in error && typeof error.name === "string") {
    return error.name;
  }

  return "";
};

const isoStringOf = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return Option.match(DateTime.make(value), {
    onNone: () => String(value),
    onSome: DateTime.formatIso,
  });
};

const baseOrigin = (): string =>
  typeof window !== "undefined" ? window.location.origin : "http://localhost";

const readErrorCode = (json: unknown): string | null =>
  Option.match(Schema.decodeUnknownOption(ErrorPayload)(json), {
    onNone: () => null,
    onSome: (value) => value.code ?? null,
  });

export const detectPasskeyCapabilities: Effect.Effect<PasskeyCapabilities> = Effect.gen(function* () {
  if (
    typeof window === "undefined" ||
    typeof PublicKeyCredential !== "function" ||
    typeof navigator === "undefined" ||
    navigator.credentials === undefined
  ) {
    return defaultPasskeyCapabilities;
  }

  if (typeof PublicKeyCredential.getClientCapabilities === "function") {
    const capabilities = yield* Effect.tryPromise({
      try: () => PublicKeyCredential.getClientCapabilities(),
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null));

    if (capabilities === null) {
      return defaultPasskeyCapabilities;
    }

    const conditionalGet = Boolean(capabilities.conditionalGet);
    const platformAuthenticator = Boolean(capabilities.passkeyPlatformAuthenticator);
    const hybridTransport = Boolean(capabilities.hybridTransport);
    const userVerifying = Boolean(capabilities.userVerifyingPlatformAuthenticator);

    return {
      supported: conditionalGet || platformAuthenticator || hybridTransport || userVerifying,
      conditionalGet,
      platformAuthenticator,
    };
  }

  const platformAuthenticator =
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
      ? yield* Effect.tryPromise({
          try: () => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
          catch: () => false,
        }).pipe(Effect.orElseSucceed(() => false))
      : false;

  const conditionalGet =
    typeof PublicKeyCredential.isConditionalMediationAvailable === "function"
      ? yield* Effect.tryPromise({
          try: () => PublicKeyCredential.isConditionalMediationAvailable(),
          catch: () => false,
        }).pipe(Effect.orElseSucceed(() => false))
      : false;

  return {
    supported: platformAuthenticator || conditionalGet,
    conditionalGet,
    platformAuthenticator,
  };
});

export type PasskeySignInOutcome =
  | { readonly _tag: "Verified" }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Failed" };

const signInFailed: PasskeySignInOutcome = { _tag: "Failed" };

const signInCancelled: PasskeySignInOutcome = { _tag: "Cancelled" };

const signInVerified: PasskeySignInOutcome = { _tag: "Verified" };

export const authenticateWithPasskey = (params: {
  readonly conditional: boolean;
}): Effect.Effect<PasskeySignInOutcome> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const optionsResponse = yield* client
      .execute(HttpClientRequest.get(`${baseOrigin()}/auth/passkey/generate-authenticate-options`))
      .pipe(Effect.orElseSucceed(() => null));

    if (optionsResponse === null || optionsResponse.status < 200 || optionsResponse.status >= 300) {
      return signInFailed;
    }

    const optionsJson = yield* optionsResponse.json.pipe(Effect.orElseSucceed(() => null));
    const decodedOptions = Schema.decodeUnknownOption(RawRequestOptions)(optionsJson);

    if (Option.isNone(decodedOptions)) {
      return signInFailed;
    }

    const rawOptions = decodedOptions.value;
    const publicKey = parseRequestOptions(rawOptions);
    const rpId = rawOptions.rpId ?? publicKey.rpId;

    const credentialResult = yield* Effect.tryPromise({
      try: (signal) =>
        navigator.credentials.get({
          publicKey,
          ...(params.conditional ? { mediation: "conditional" } : {}),
          signal,
        }),
      catch: (error) => {
        const name = errorNameOf(error);

        return name === "NotAllowedError" || name === "AbortError"
          ? ("Cancelled" as const)
          : ("Failed" as const);
      },
    }).pipe(Effect.result);

    if (credentialResult._tag === "Failure") {
      return credentialResult.failure === "Cancelled" ? signInCancelled : signInFailed;
    }

    if (!(credentialResult.success instanceof PublicKeyCredential)) {
      return signInFailed;
    }

    const encoded = serializeCredential(credentialResult.success);

    if (encoded === null) {
      return signInFailed;
    }

    const encodedId = Option.getOrUndefined(
      Option.flatMap(Schema.decodeUnknownOption(EncodedIdPayload)(encoded), (parsed) =>
        Option.fromUndefinedOr(parsed.id),
      ),
    );

    const verifyResponse = yield* client
      .execute(
        HttpClientRequest.post(`${baseOrigin()}/auth/passkey/verify-authentication`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ response: encoded }),
        ),
      )
      .pipe(Effect.orElseSucceed(() => null));

    if (verifyResponse === null) {
      return signInFailed;
    }

    if (verifyResponse.status >= 200 && verifyResponse.status < 300) {
      return signInVerified;
    }

    const errorJson = yield* verifyResponse.json.pipe(Effect.orElseSucceed(() => null));
    const code = readErrorCode(errorJson);

    if (verifyResponse.status === 404 || code === "PASSKEY_NOT_FOUND") {
      yield* signalUnknownCredentialSafe(rpId, encodedId);
    }

    return signInFailed;
  }).pipe(Effect.provide(FetchHttpClient.layer));

export type PasskeyRegisterOutcome =
  | { readonly _tag: "Success" }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Failure"; readonly failure: Failure };

const failureOutcome = (failure: Failure): PasskeyRegisterOutcome => ({ _tag: "Failure", failure });

const registerSuccess: PasskeyRegisterOutcome = { _tag: "Success" };

const registerCancelled: PasskeyRegisterOutcome = { _tag: "Cancelled" };

export const registerPasskey = (name?: string): Effect.Effect<PasskeyRegisterOutcome> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const trimmedName = name?.trim() ?? "";
    const query = trimmedName === "" ? "" : `?name=${encodeURIComponent(trimmedName)}`;

    const optionsResponse = yield* client
      .execute(HttpClientRequest.get(`${baseOrigin()}/auth/passkey/generate-register-options${query}`))
      .pipe(Effect.orElseSucceed(() => null));

    if (optionsResponse === null) {
      return failureOutcome("Unavailable");
    }

    if (optionsResponse.status < 200 || optionsResponse.status >= 300) {
      if (optionsResponse.status === 401) {
        return failureOutcome("Unauthenticated");
      }

      const errorJson = yield* optionsResponse.json.pipe(Effect.orElseSucceed(() => null));
      const code = readErrorCode(errorJson);

      if (optionsResponse.status === 403 || code === "SESSION_NOT_FRESH") {
        return failureOutcome("PasskeySignInAgainRequired");
      }

      return failureOutcome("Unavailable");
    }

    const optionsJson = yield* optionsResponse.json.pipe(Effect.orElseSucceed(() => null));
    const decodedOptions = Schema.decodeUnknownOption(RawCreationOptions)(optionsJson);

    if (Option.isNone(decodedOptions)) {
      return failureOutcome("Unavailable");
    }

    const rawOptions = decodedOptions.value;
    const publicKey = parseCreationOptions(rawOptions);
    const rpId = rawOptions.rp.id ?? publicKey.rp.id;

    const credentialResult = yield* Effect.tryPromise({
      try: (signal) => navigator.credentials.create({ publicKey, signal }),
      catch: errorNameOf,
    }).pipe(Effect.result);

    if (credentialResult._tag === "Failure") {
      if (credentialResult.failure === "InvalidStateError") {
        return failureOutcome("PasskeyAlreadyExists");
      }

      if (credentialResult.failure === "NotAllowedError" || credentialResult.failure === "AbortError") {
        return registerCancelled;
      }

      return failureOutcome("Unavailable");
    }

    if (!(credentialResult.success instanceof PublicKeyCredential)) {
      return failureOutcome("Unavailable");
    }

    const encoded = serializeCredential(credentialResult.success);

    if (encoded === null) {
      return failureOutcome("Unavailable");
    }

    const encodedId = Option.getOrUndefined(
      Option.flatMap(Schema.decodeUnknownOption(EncodedIdPayload)(encoded), (parsed) =>
        Option.fromUndefinedOr(parsed.id),
      ),
    );

    const verifyResponse = yield* client
      .execute(
        HttpClientRequest.post(`${baseOrigin()}/auth/passkey/verify-registration`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            response: encoded,
            ...(trimmedName === "" ? {} : { name: trimmedName }),
          }),
        ),
      )
      .pipe(Effect.orElseSucceed(() => null));

    if (verifyResponse === null) {
      yield* signalUnknownCredentialSafe(rpId, encodedId);

      return failureOutcome("Unavailable");
    }

    if (verifyResponse.status < 200 || verifyResponse.status >= 300) {
      yield* signalUnknownCredentialSafe(rpId, encodedId);

      if (verifyResponse.status === 401) {
        return failureOutcome("Unauthenticated");
      }

      const errorJson = yield* verifyResponse.json.pipe(Effect.orElseSucceed(() => null));
      const code = readErrorCode(errorJson);

      if (verifyResponse.status === 403 || code === "SESSION_NOT_FRESH") {
        return failureOutcome("PasskeySignInAgainRequired");
      }

      return failureOutcome("Unavailable");
    }

    return registerSuccess;
  }).pipe(Effect.provide(FetchHttpClient.layer));

export type PasskeyListOutcome =
  | { readonly _tag: "Success"; readonly passkeys: readonly PasskeyItem[] }
  | { readonly _tag: "Failure"; readonly failure: Failure };

const listFailure = (failure: Failure): PasskeyListOutcome => ({ _tag: "Failure", failure });

const listSuccess = (passkeys: readonly PasskeyItem[]): PasskeyListOutcome => ({ _tag: "Success", passkeys });

export const listUserPasskeys: Effect.Effect<PasskeyListOutcome> = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const response = yield* client
    .execute(HttpClientRequest.get(`${baseOrigin()}/auth/passkey/list-user-passkeys`))
    .pipe(Effect.orElseSucceed(() => null));

  if (response === null) {
    return listFailure("Unavailable");
  }

  if (response.status < 200 || response.status >= 300) {
    return listFailure(response.status === 401 ? "Unauthenticated" : "Unavailable");
  }

  const body = yield* response.json.pipe(Effect.orElseSucceed(() => null));
  const decoded = Schema.decodeUnknownOption(RawPasskeyList)(body);

  if (Option.isNone(decoded)) {
    return listFailure("Unavailable");
  }

  return listSuccess(
    decoded.value.map((row) => ({
      id: row.id,
      name: row.name ?? null,
      credentialID: row.credentialID,
      deviceType: row.deviceType,
      backedUp: Boolean(row.backedUp),
      createdAt: isoStringOf(row.createdAt),
      aaguid: row.aaguid ?? null,
    })),
  );
}).pipe(Effect.provide(FetchHttpClient.layer));

export type PasskeyMutationOutcome =
  | { readonly _tag: "Success" }
  | { readonly _tag: "Failure"; readonly failure: Failure };

const mutationFailure = (failure: Failure): PasskeyMutationOutcome => ({ _tag: "Failure", failure });

const mutationSuccess: PasskeyMutationOutcome = { _tag: "Success" };

const postPasskeyMutation = (path: string, body: unknown): Effect.Effect<PasskeyMutationOutcome> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client
      .execute(HttpClientRequest.post(`${baseOrigin()}${path}`).pipe(HttpClientRequest.bodyJsonUnsafe(body)))
      .pipe(Effect.orElseSucceed(() => null));

    if (response === null) {
      return mutationFailure("Unavailable");
    }

    if (response.status >= 200 && response.status < 300) {
      return mutationSuccess;
    }

    if (response.status === 401) {
      return mutationFailure("Unauthenticated");
    }

    if (response.status === 404) {
      return mutationFailure("NotFound");
    }

    return mutationFailure("Unavailable");
  }).pipe(Effect.provide(FetchHttpClient.layer));

export const renameUserPasskey = (id: string, name: string): Effect.Effect<PasskeyMutationOutcome> =>
  postPasskeyMutation("/auth/passkey/update-passkey", { id, name });

export const deleteUserPasskey = (id: string): Effect.Effect<PasskeyMutationOutcome> =>
  postPasskeyMutation("/auth/passkey/delete-passkey", { id });
