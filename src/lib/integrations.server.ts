/**
 * Connections Hub storage + public live-status fetchers. Server-only.
 * `verified` is derived here from real sign-in identities — never from input.
 */
import { sql } from "@/lib/neon";
import { integrationById } from "./integrations-catalog";
import { normalizeIntegrationValue, visibleForMode, type Audience } from "./integrations-rules";

type Row = Record<string, unknown>;

export type IntegrationStatus = {
  title?: string;
  subtitle?: string;
  url?: string;
  image?: string | null;
};

export type MyIntegration = {
  provider: string;
  handle: string;
  audience: Audience;
  visible: boolean;
  verified: boolean;
  showOnVerified: boolean;
  showOnAlias: boolean;
};

export type PublicIntegration = MyIntegration & { status: IntegrationStatus | null };

const STATUS_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

function toMine(r: Row): MyIntegration {
  return {
    provider: String(r["provider"]),
    handle: String(r["handle"]),
    audience: (r["audience"] as Audience) ?? "both",
    visible: r["visible"] !== false,
    verified: r["verified"] === true,
    showOnVerified: r["show_on_verified"] !== false,
    showOnAlias: r["show_on_alias"] !== false,
  };
}

/** Handles proven by sign-in, keyed by catalogue provider id. */
export async function ssoHandles(userId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const { listIdentities } = await import("./identities.server");
    const ids = await listIdentities(userId);
    for (const id of ids) {
      const p = id.provider.toLowerCase();
      if (p === "github" && !out["github"]) {
        const login = await githubLoginById(id.providerAccountId);
        if (login) out["github"] = login;
      } else if (p === "gitlab" && !out["gitlab"]) {
        const login = await gitlabLoginById(id.providerAccountId);
        if (login) out["gitlab"] = login;
      } else if (p === "bluesky" && !out["bluesky"]) {
        const h = id.displayName && id.displayName.includes(".") ? id.displayName : await atHandleForDid(id.providerAccountId);
        if (h) out[h.endsWith(".wsocial.eu") ? "wsocial" : "bluesky"] = h.toLowerCase();
      }
    }
  } catch (e) {
    console.warn("[integrations] sso lookup failed", e instanceof Error ? e.message : e);
  }
  return out;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "rout.be", ...headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function githubLoginById(id: string): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  const j = (await getJson(`https://api.github.com/user/${id}`, githubAuth())) as { login?: string } | null;
  return j?.login ?? null;
}

async function gitlabLoginById(id: string): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  const j = (await getJson(`https://gitlab.com/api/v4/users/${id}`)) as { username?: string } | null;
  return j?.username ?? null;
}

async function atHandleForDid(did: string): Promise<string | null> {
  if (!/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(did)) return null;
  const j = (await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)) as { handle?: string } | null;
  return j?.handle ?? null;
}

function githubAuth(): Record<string, string> {
  const t = process.env["GITHUB_PUBLIC_TOKEN"];
  return t ? { authorization: `Bearer ${t}` } : {};
}

function ago(iso: string | undefined): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min geleden`;
  const h = Math.round(mins / 60);
  if (h < 24) return h === 1 ? "1 uur geleden" : `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? "gisteren" : `${d} dagen geleden`;
}

function isToday(iso: string | undefined): boolean {
  return !!iso && Date.now() - Date.parse(iso) < 24 * 3600 * 1000;
}

/** Fetches the live status for one connection from public sources. */
export async function fetchStatus(provider: string, handle: string): Promise<IntegrationStatus | null> {
  switch (provider) {
    case "github": {
      const ev = (await getJson(`https://api.github.com/users/${encodeURIComponent(handle)}/events/public?per_page=10`, githubAuth())) as
        | { type: string; created_at: string; repo?: { name: string }; payload?: { commits?: { message: string }[] } }[]
        | null;
      const push = ev?.find((e) => e.type === "PushEvent");
      const last = ev?.[0];
      return {
        title: isToday(last?.created_at) ? "Actief vandaag" : last ? `Laatst actief ${ago(last.created_at)}` : "Geen recente activiteit",
        subtitle: push ? `${push.repo?.name ?? ""} · ${(push.payload?.commits?.at(-1)?.message ?? "").split("\n")[0]}`.slice(0, 120) : undefined,
        url: `https://github.com/${handle}`,
        image: `https://avatars.githubusercontent.com/${handle}`,
      };
    }
    case "gitlab": {
      const users = (await getJson(`https://gitlab.com/api/v4/users?username=${encodeURIComponent(handle)}`)) as { id: number; avatar_url?: string }[] | null;
      const u = users?.[0];
      if (!u) return null;
      const ev = (await getJson(`https://gitlab.com/api/v4/users/${u.id}/events?per_page=5`)) as
        | { created_at: string; action_name: string; push_data?: { commit_title?: string } }[]
        | null;
      const last = ev?.[0];
      return {
        title: isToday(last?.created_at) ? "Actief vandaag" : last ? `Laatst actief ${ago(last.created_at)}` : "Geen recente activiteit",
        subtitle: last?.push_data?.commit_title?.slice(0, 120),
        url: `https://gitlab.com/${handle}`,
        image: u.avatar_url ?? null,
      };
    }
    case "wakatime": {
      const j = (await getJson(`https://wakatime.com/api/v1/users/${encodeURIComponent(handle)}/stats/last_7_days`)) as
        | { data?: { languages?: { name: string; total_seconds: number }[]; human_readable_daily_average?: string } }
        | null;
      const lang = j?.data?.languages?.[0];
      if (!j?.data) return null;
      return {
        title: lang ? `Codeert vooral in ${lang.name}` : "Aan het coderen",
        subtitle: j.data.human_readable_daily_average ? `${j.data.human_readable_daily_average} per dag` : undefined,
        url: `https://wakatime.com/@${handle}`,
      };
    }
    case "bluesky":
    case "wsocial": {
      const j = (await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`)) as
        | { displayName?: string; followersCount?: number; avatar?: string }
        | null;
      if (!j) return null;
      return {
        title: j.displayName || `@${handle}`,
        subtitle: typeof j.followersCount === "number" ? `${j.followersCount.toLocaleString("nl-BE")} volgers` : undefined,
        url: provider === "wsocial" ? `https://wsocial.eu/profile/${handle}` : `https://bsky.app/profile/${handle}`,
        image: j.avatar ?? null,
      };
    }
    case "youtube": {
      let channelId = handle.startsWith("UC") ? handle : null;
      if (!channelId) {
        try {
          const page = await fetch(`https://www.youtube.com/${handle}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "accept-language": "en" } });
          const html = page.ok ? await page.text() : "";
          channelId = html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] ?? null;
        } catch {
          channelId = null;
        }
      }
      if (!channelId) return null;
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return null;
        const xml = await res.text();
        const entry = xml.split("<entry>")[1] ?? "";
        const title = entry.match(/<title>([^<]*)<\/title>/)?.[1];
        const vid = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
        const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
        return {
          title: title ? decodeXml(title) : "YouTube-kanaal",
          subtitle: published ? `Nieuwste video · ${ago(published)}` : undefined,
          url: vid ? `https://www.youtube.com/watch?v=${vid}` : `https://www.youtube.com/channel/${channelId}`,
          image: vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null,
        };
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export async function listMine(userId: string): Promise<MyIntegration[]> {
  const rows = (await sql`
    select provider, handle, audience, visible, verified, show_on_verified, show_on_alias from public.user_integrations
     where user_id = ${userId} order by created_at`) as Row[];
  return rows.map(toMine);
}

export async function saveMine(
  userId: string,
  input: { provider: string; handle?: string; audience: Audience; visible: boolean; useSso?: boolean; showOnVerified?: boolean; showOnAlias?: boolean },
): Promise<MyIntegration> {
  const item = integrationById(input.provider);
  if (!item || item.mode === "soon" || item.mode === "oauth") throw new Error("unsupported_provider");
  const sso = item.sso || input.provider === "wsocial" ? await ssoHandles(userId) : {};
  const ssoHandle = sso[input.provider];
  const handle = input.useSso && ssoHandle ? ssoHandle : normalizeIntegrationValue(input.provider, input.handle ?? "");
  if (!handle) throw new Error("invalid_value");
  const verified = Boolean(ssoHandle && ssoHandle.toLowerCase() === handle.toLowerCase());
  const rows = (await sql`
    insert into public.user_integrations (user_id, provider, handle, audience, visible, verified, status_json, status_at, show_on_verified, show_on_alias)
    values (${userId}, ${input.provider}, ${handle}, ${input.audience}, ${input.visible}, ${verified}, null, null,
            ${input.showOnVerified ?? true}, ${input.showOnAlias ?? true})
    on conflict (user_id, provider) do update set
      handle = excluded.handle, audience = excluded.audience, visible = excluded.visible,
      show_on_verified = coalesce(${input.showOnVerified ?? null}::boolean, public.user_integrations.show_on_verified),
      show_on_alias = coalesce(${input.showOnAlias ?? null}::boolean, public.user_integrations.show_on_alias),
      verified = excluded.verified,
      status_json = case when public.user_integrations.handle = excluded.handle then public.user_integrations.status_json end,
      status_at = case when public.user_integrations.handle = excluded.handle then public.user_integrations.status_at end,
      updated_at = now()
    returning provider, handle, audience, visible, verified, show_on_verified, show_on_alias`) as Row[];
  return toMine(rows[0]!);
}

export async function removeMine(userId: string, provider: string): Promise<void> {
  await sql`delete from public.user_integrations where user_id = ${userId} and provider = ${provider}`;
}

/** Public cards for a handle; respects publicProfile and the Pro/Social face. */
export async function publicIntegrations(handle: string, mode: "pro" | "social" | null): Promise<PublicIntegration[]> {
  const rows = (await sql`
    select i.user_id, i.provider, i.handle, i.audience, i.visible, i.verified, i.status_json, i.status_at
      from public.user_integrations i
      left join public.profiles p on p.id = i.user_id
      left join public.alias_profiles a on a.user_id = i.user_id
     where i.visible = true
       and (lower(p.username) = lower(${handle}) or lower(a.handle) = lower(${handle}))
       and coalesce((coalesce(a.display_prefs, p.display_prefs) ->> 'publicProfile')::boolean, true)
       and case when lower(a.handle) = lower(${handle}) then i.show_on_alias else i.show_on_verified end
     order by i.created_at
     limit 40`) as Row[];
  const shown = visibleForMode(rows.map((r) => ({ ...toMine(r), row: r })), mode);
  return Promise.all(
    shown.map(async ({ row, ...m }) => {
      let status = (row["status_json"] as IntegrationStatus | null) ?? null;
      const at = row["status_at"] ? Date.parse(String(row["status_at"])) : 0;
      const item = integrationById(m.provider);
      if (item?.mode === "handle" && Date.now() - at > STATUS_TTL_MS) {
        const fresh = await fetchStatus(m.provider, m.handle);
        if (fresh) {
          status = fresh;
          await sql`update public.user_integrations set status_json = ${JSON.stringify(fresh)}::jsonb, status_at = now()
                     where user_id = ${String(row["user_id"])} and provider = ${m.provider}`.catch(() => undefined);
        }
      }
      return { ...m, status };
    }),
  );
}
