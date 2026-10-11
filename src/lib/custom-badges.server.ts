/**
 * Eigen badges (familiewapens, bedrijfslogo's). Elke admin-export gaat ervan uit
 * dat `assertAdminRole` al geslaagd is in `custom-badges.functions.ts`.
 */
import { sql } from "@/lib/neon";

type Row = Record<string, unknown>;

export type CustomBadge = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  holders: number;
};

export type BadgeHolder = { userId: string; username: string | null; displayName: string | null; grantedAt: string };

const toBadge = (r: Row): CustomBadge => ({
  id: String(r["id"]),
  slug: String(r["slug"]),
  name: String(r["name"]),
  description: (r["description"] as string | null) ?? null,
  imageUrl: (r["image_url"] as string | null) ?? null,
  holders: Number(r["holders"] ?? 0),
});

export async function listCustomBadges(): Promise<CustomBadge[]> {
  const rows = (await sql`
    select b.id, b.slug, b.name, b.description, b.image_url,
           (select count(*) from public.user_custom_badges u where u.badge_id = b.id)::int as holders
      from public.custom_badges b
     order by b.created_at desc
  `) as Row[];
  return rows.map(toBadge);
}

export async function createCustomBadge(input: {
  name: string;
  description: string | null;
  imageUrl: string | null;
  adminId: string;
}) {
  const base = input.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "badge";
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const rows = (await sql`
    insert into public.custom_badges (slug, name, description, image_url, created_by)
    values (${slug}, ${input.name}, ${input.description}, ${input.imageUrl}, ${input.adminId})
    returning id, slug, name, description, image_url, 0 as holders
  `) as Row[];
  return toBadge(rows[0]!);
}

export async function updateCustomBadge(id: string, input: { name: string; description: string | null; imageUrl: string | null }) {
  await sql`
    update public.custom_badges
       set name = ${input.name}, description = ${input.description}, image_url = ${input.imageUrl}
     where id = ${id}
  `;
  return { ok: true as const };
}

export async function deleteCustomBadge(id: string) {
  await sql`delete from public.custom_badges where id = ${id}`;
  return { ok: true as const };
}

export async function listBadgeHolders(badgeId: string): Promise<BadgeHolder[]> {
  const rows = (await sql`
    select u.user_id, p.username, p.display_name, u.granted_at
      from public.user_custom_badges u
      left join public.profiles p on p.id = u.user_id
     where u.badge_id = ${badgeId}
     order by u.granted_at desc
  `) as Row[];
  return rows.map((r) => ({
    userId: String(r["user_id"]),
    username: (r["username"] as string | null) ?? null,
    displayName: (r["display_name"] as string | null) ?? null,
    grantedAt: String(r["granted_at"]),
  }));
}

/** Zoekt op handle (profiel of alias) of weergavenaam. */
export async function findUsersByHandle(query: string) {
  const q = query.replace(/^@+/, "").trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const rows = (await sql`
    select id, username, display_name
      from public.profiles
     where lower(username) like ${like} or lower(coalesce(display_name, '')) like ${like}
     order by (lower(username) = ${q}) desc, username
     limit 10
  `) as Row[];
  return rows.map((r) => ({
    userId: String(r["id"]),
    username: (r["username"] as string | null) ?? null,
    displayName: (r["display_name"] as string | null) ?? null,
  }));
}

export async function grantCustomBadge(userId: string, badgeId: string, adminId: string) {
  await sql`
    insert into public.user_custom_badges (user_id, badge_id, granted_by)
    values (${userId}, ${badgeId}, ${adminId})
    on conflict (user_id, badge_id) do nothing
  `;
  return { ok: true as const };
}

export async function revokeCustomBadge(userId: string, badgeId: string) {
  await sql`delete from public.user_custom_badges where user_id = ${userId} and badge_id = ${badgeId}`;
  return { ok: true as const };
}

export async function badgesForUser(userId: string): Promise<CustomBadge[]> {
  const rows = (await sql`
    select b.id, b.slug, b.name, b.description, b.image_url, 0 as holders
      from public.user_custom_badges u
      join public.custom_badges b on b.id = u.badge_id
     where u.user_id = ${userId}
     order by u.granted_at
  `) as Row[];
  return rows.map(toBadge);
}

/** Publiek: badges van een handle, enkel naam/omschrijving/afbeelding. */
export async function publicBadgesForHandle(rawHandle: string) {
  const handle = rawHandle.replace(/^@+/, "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{1,63}$/.test(handle)) return [];
  try {
    const rows = (await sql`
      select b.slug, b.name, b.description, b.image_url
        from public.profiles p
        join public.user_custom_badges u on u.user_id = p.id
        join public.custom_badges b on b.id = u.badge_id
       where p.username = ${handle}
         and coalesce(p.is_banned, false) = false
       order by u.granted_at
       limit 12
    `) as Row[];
    return rows.map((r) => ({
      slug: String(r["slug"]),
      name: String(r["name"]),
      description: (r["description"] as string | null) ?? null,
      imageUrl: (r["image_url"] as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}
