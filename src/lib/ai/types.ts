/** /api/ai/draft 응답 (일지 화면과 공유) */
export type DraftResponse =
  | { ok: true; text: string; left: number }
  | { ok: false; reason: "NO_PROVIDER" | "ALL_FAILED" | "QUOTA" | "BAD_REQUEST"; prompt?: string; left: number };
