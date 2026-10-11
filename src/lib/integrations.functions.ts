import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";

/** The caller's hub state: saved connections + handles proven by sign-in. */
export const getMyIntegrations = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const s = await import("./integrations.server");
    try {
      const [items, sso] = await Promise.all([s.listMine(context.userId), s.ssoHandles(context.userId)]);
      return { ready: true, items, sso };
    } catch (e) {
      console.error("[integrations] list failed", e instanceof Error ? e.message : e);
      return { ready: false, items: [], sso: {} as Record<string, string> };
    }
  });

const saveSchema = z.object({
  provider: z.string().regex(/^[a-z0-9_]{2,32}$/),
  handle: z.string().trim().max(200).optional(),
  audience: z.enum(["pro", "social", "both"]),
  visible: z.boolean(),
  useSso: z.boolean().optional(),
  showOnVerified: z.boolean().optional(),
  showOnAlias: z.boolean().optional(),
});

export const saveIntegration = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => saveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const s = await import("./integrations.server");
    try {
      return { ok: true as const, item: await s.saveMine(context.userId, data) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "invalid_value" || msg === "unsupported_provider") return { ok: false as const, error: msg };
      console.error("[integrations] save failed", msg);
      return { ok: false as const, error: "save_failed" };
    }
  });

export const removeIntegration = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ provider: z.string().regex(/^[a-z0-9_]{2,32}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const s = await import("./integrations.server");
    await s.removeMine(context.userId, data.provider);
    return { ok: true };
  });
