// Every limit of the public application form lives here, in one place (no number is repeated in the code that uses it).
// Client-safe: no Node built-ins, so the form can show the same limits the server enforces.

/** The certificates an applicant may attach: only these types, checked by the declared type AND the file's first bytes. */
export const APPLICATION_FILE_TYPES = [
  { mime: "application/pdf", ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
] as const;
export const APPLICATION_ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png";

export const RECRUITMENT_LIMITS = {
  /** One certificate, in bytes. */
  maxFileBytes: 3 * 1024 * 1024,
  /** Certificates per application. */
  maxFiles: 5,
  /** The whole request: the files plus room for the text fields. The route refuses a larger body before reading it. */
  maxRequestBytes: 3 * 1024 * 1024 * 5 + 256 * 1024,
  /** Applications one address may send per window, and the window. */
  perIpLimit: 5,
  perIpWindowMs: 60 * 60 * 1000,
  /** Applications the whole form accepts per window (bounds a flood from many, or spoofed, addresses). */
  globalLimit: 300,
  globalWindowMs: 60 * 60 * 1000,
  /** Text fields. */
  maxName: 120,
  maxPhone: 20,
  minPhoneDigits: 7,
  maxEmail: 160,
  nationalIdLength: 14,
  maxCity: 120,
  maxEducation: 190,
  maxExperience: 4000,
  maxExpectedSalary: 1_000_000,
  maxFileName: 120,
  /** Notes HR keeps on an application. */
  maxNote: 4000,
  maxJobTitle: 190,
  maxJobDescription: 4000,
} as const;

/** The status an application can have, in the order HR works through them. */
export const APPLICATION_STATUSES = ["new", "reviewed", "shortlisted", "rejected", "hired"] as const;
export type ApplicationStatusKey = (typeof APPLICATION_STATUSES)[number];

/** The name of the hidden trap field. A person never sees it; a bot that fills every input does. */
export const HONEYPOT_FIELD = "website";
