// Every limit of the case-proof tool lives here, in one place. Client-safe: no Node built-ins, so the form can show the same
// limits the server enforces.

/** The photo types accepted: checked by the declared type AND the file's first bytes (a renamed file is refused). */
export const CASE_PHOTO_TYPES = [
  { mime: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  // RIFF....WEBP: the employee documents already accept webp, so a phone's webp photo works here too
  { mime: "image/webp", ext: "webp", magic: [0x52, 0x49, 0x46, 0x46], magicAt8: [0x57, 0x45, 0x42, 0x50] },
] as const;
export const CASE_PHOTO_ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp";

export const CASE_PROOF_LIMITS = {
  /** One photo, in bytes. */
  maxPhotoBytes: 5 * 1024 * 1024,
  /** Photos a single case may carry at once (an upload, or adding more to a draft later, is refused past this). */
  maxPhotosPerCase: 10,
  /** The whole upload request (every photo plus the other fields). Refused before it is read when it says it is larger. */
  maxRequestBytes: 5 * 1024 * 1024 * 10 + 64 * 1024,
  /** The description a supervisor saves, and the AI draft kept next to it. */
  maxTextLength: 2000,
  maxDraftLength: 1200,
  /** How long the app waits for the AI draft before giving the supervisor an empty field instead. */
  aiTimeoutMs: 90_000,
  /** Uploads (each one asks the AI once) a person may make per window. */
  uploadsPerUser: 20,
  uploadsWindowMs: 60 * 60 * 1000,
  /** Employees one case may be attached to (a group). */
  maxEmployeesPerCase: 30,
  /** Context strings handed to the AI are cut to this length. */
  maxContextLength: 120,
} as const;

/** The department supervisors' account role. */
export const CASE_PROOF_SUPERVISOR_ROLE = "supervisor";
