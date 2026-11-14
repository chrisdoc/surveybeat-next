export const providerStatusOf = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;

export const isProviderRefusal = (error: unknown): boolean => {
  const status = providerStatusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

export const isProviderUnreachable = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && typeof error.code === "string" && /^ERR_JWKS|^ERR_JOSE_GENERIC/.test(error.code)) {
    return true;
  }
  const status = providerStatusOf(error);
  return status !== undefined && (status >= 500 || status === 408 || status === 429);
};
