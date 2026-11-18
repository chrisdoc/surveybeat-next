export const minutes = (count: number): number => count * 60_000;

export const days = (count: number): number => count * 24 * 60 * 60_000;

export const toSeconds = (milliseconds: number): number => milliseconds / 1000;

export const Policy = {
  signIn: {
    codeMinutes: 10,
    codeDigits: 6,
    codeAttempts: 5,
    magicLinkMinutes: 5,
    sessionDays: 30,
  },
  text: { noteMaxLength: 2000, longTextMaxLength: 1000 },
  backupRetentionDays: 30,
  testSend: {
    perHour: 5,
    lifetimeDays: 7,
    pollSeconds: 3,
    stalledMinutes: 5,
    giveUpMinutes: 15,
  },
  groupSize: { defaultValue: 4, minimum: 3, maximum: 100 },
  questions: { maximum: 20, recommended: 7 },
  sendWindow: { earliest: "06:00", latest: "21:00" },
  themes: { maximum: 5 },
  trendRounds: 12,
} as const;
