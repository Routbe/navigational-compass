import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";

/** Super Admin: eigen badges beheren. Elke call controleert de admin-rol server-side. */
async function guard(userId: string) {
  const { assertAdminRole } = await import("./admin.server");
  await assertAdminRole(userId);
  const { enforceRateLimit } = await import("./rate-limit.server");
  enforceRateLimit(`custom-badges:${userId}`, 120, 60_000);
}

const imageUrl = z.string().url().max(600).nullable().optional();

export const adminListCustomBadges = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await guard(context.userId);
    const { listCustomBadges } = await import("./custom-badges.server");
    return listCustomBadges();
  });

export const adminCreateCustomBadge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().max(200).nullable().optional(), imageUrl }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const { createCustomBadge } = await import("./custom-badges.server");
    return createCustomBadge({ name: data.name, description: data.description ?? null, imageUrl: data.imageUrl ?? null, adminId: context.userId });
  });

export const adminUpdateCustomBadge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(60), description: z.string().trim().max(200).nullable().optional(), imageUrl }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const { updateCustomBadge } = await import("./custom-badges.server");
    return updateCustomBadge(data.id, { name: data.name, description: data.description ?? null, imageUrl: data.imageUrl ?? null });
  });

export const adminDeleteCustomBadge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const { deleteCustomBadge } = await import("./custom-badges.server");
    return deleteCustomBadge(data.id);
  });

/** Upload van een badge-afbeelding naar de interne bucket (ROUT-asset). */
export const adminUploadBadgeImage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ base64: z.string().min(16).max(2_800_000) }).parse(d))
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const s = await import("@/lib/storage/s3.server");
    const bytes = s.base64ToBytes(data.base64);
    const real = s.sniffType(bytes);
    if (!real || !(s.IMAGE_TYPES as readonly string[]).includes(real)) return { ok: false as const, message: "Gebruik PNG, JPG of WebP." };
    if (!s.storageConfigured("internal")) return { ok: false as const, message: "Opslag is niet ingesteld." };
    const key = `badges/custom/${crypto.randomUUID()}.${s.extFor(real)}`;
    await s.putObject("internal", key, bytes, { contentType: real, publicRead: true });
    return { ok: true as const, url: s.publicUrl("internal", key) };
  });

export const adminListBadgeHolders = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ badgeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const { listBadgeHolders } = await import("./custom-badges.server");
    return listBadgeHolders(data.badgeId);
  });

export const adminFindUsers = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ query: z.string().max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const { findUsersByHandle } = await import("./custom-badges.server");
    return findUsersByHandle(data.query);
  });

export const adminUserCustomBadges = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const { badgesForUser } = await import("./custom-badges.server");
    return badgesForUser(data.userId);
  });

export const adminSetCustomBadge = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), badgeId: z.string().uuid(), granted: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await guard(context.userId);
    const m = await import("./custom-badges.server");
    return data.granted
      ? m.grantCustomBadge(data.userId, data.badgeId, context.userId)
      : m.revokeCustomBadge(data.userId, data.badgeId);
  });

/** Publiek: eigen badges op een profiel. */
export const getPublicCustomBadges = createServerFn({ method: "GET" })
  .inputValidator((d: { handle: string }) => z.object({ handle: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { publicBadgesForHandle } = await import("./custom-badges.server");
    return publicBadgesForHandle(data.handle);
  });
