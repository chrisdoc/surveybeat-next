export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(token);
}
