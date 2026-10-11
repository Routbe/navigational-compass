import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Plus, Search, Shield, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  adminCreateCustomBadge,
  adminDeleteCustomBadge,
  adminFindUsers,
  adminListBadgeHolders,
  adminListCustomBadges,
  adminSetCustomBadge,
  adminUploadBadgeImage,
  adminUserCustomBadges,
} from "@/lib/custom-badges.functions";

type Badge = Awaited<ReturnType<typeof adminListCustomBadges>>[number];
type Holder = Awaited<ReturnType<typeof adminListBadgeHolders>>[number];
type Found = Awaited<ReturnType<typeof adminFindUsers>>[number];

export const fileToBase64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export function BadgeEmblem({ badge, size = 40 }: { badge: { name: string; imageUrl: string | null }; size?: number }) {
  return badge.imageUrl ? (
    <img src={badge.imageUrl} alt={badge.name} width={size} height={size} className="rounded-lg object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="grid place-items-center rounded-lg bg-muted text-muted-foreground" style={{ width: size, height: size }}>
      <Shield className="h-1/2 w-1/2" aria-hidden />
    </span>
  );
}

/** Zoekveld op handle: geeft één gekozen gebruiker terug. */
function UserSearch({ onPick, placeholder = "Zoek op @handle of naam" }: { onPick: (u: Found) => void; placeholder?: string }) {
  const find = useServerFn(adminFindUsers);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  useEffect(() => {
    if (q.replace(/^@/, "").trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void find({ data: { query: q } }).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, find]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="Gebruiker zoeken" />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          {results.map((u) => (
            <li key={u.userId}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick(u);
                  setQ("");
                  setResults([]);
                }}
              >
                <span className="font-medium">@{u.username ?? "—"}</span>
                <span className="truncate pl-3 text-xs text-muted-foreground">{u.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewBadgeForm({ onCreated }: { onCreated: () => void }) {
  const create = useServerFn(adminCreateCustomBadge);
  const upload = useServerFn(adminUploadBadgeImage);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await create({ data: { name, description: description || null, imageUrl } });
          toast.success("Badge aangemaakt");
          setName("");
          setDescription("");
          setImageUrl(null);
          onCreated();
        } catch {
          toast.error("Aanmaken mislukt");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-medium">Nieuwe badge</h2>
      <div className="flex items-start gap-4">
        <label className="cursor-pointer">
          <BadgeEmblem badge={{ name: name || "Badge", imageUrl }} size={64} />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2_000_000) return toast.error("Maximaal 2 MB");
              const res = await upload({ data: { base64: await fileToBase64(file) } }).catch(() => null);
              if (res?.ok) setImageUrl(res.url);
              else toast.error(res && !res.ok ? res.message : "Upload mislukt");
            }}
          />
          <span className="mt-1 block text-center text-[11px] text-muted-foreground">Afbeelding</span>
        </label>
        <div className="flex-1 space-y-2">
          <div>
            <Label htmlFor="cb-name">Naam</Label>
            <Input id="cb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Familie Van Damme" required minLength={2} maxLength={60} />
          </div>
          <div>
            <Label htmlFor="cb-desc">Omschrijving</Label>
            <Textarea id="cb-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} placeholder="Familiewapen sinds 1832" />
          </div>
        </div>
      </div>
      <Button type="submit" disabled={busy || name.trim().length < 2}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Badge aanmaken
      </Button>
    </form>
  );
}

function BadgeDetail({ badge, onBack, onChanged }: { badge: Badge; onBack: () => void; onChanged: () => void }) {
  const listHolders = useServerFn(adminListBadgeHolders);
  const setBadge = useServerFn(adminSetCustomBadge);
  const remove = useServerFn(adminDeleteCustomBadge);
  const [holders, setHolders] = useState<Holder[]>([]);
  const refresh = useCallback(() => {
    void listHolders({ data: { badgeId: badge.id } }).then(setHolders).catch(() => toast.error("Laden mislukt"));
  }, [badge.id, listHolders]);
  useEffect(refresh, [refresh]);

  const toggle = async (userId: string, granted: boolean) => {
    try {
      await setBadge({ data: { userId, badgeId: badge.id, granted } });
      toast.success(granted ? "Badge toegekend" : "Badge ingetrokken");
      refresh();
      onChanged();
    } catch {
      toast.error("Mislukt");
    }
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Alle badges
      </button>
      <header className="flex items-center gap-4">
        <BadgeEmblem badge={badge} size={72} />
        <div className="flex-1">
          <h2 className="font-display text-2xl">{badge.name}</h2>
          {badge.description && <p className="text-sm text-muted-foreground">{badge.description}</p>}
        </div>
        <Button
          variant="outline"
          className="text-destructive"
          onClick={async () => {
            if (!window.confirm(`"${badge.name}" definitief verwijderen bij alle houders?`)) return;
            await remove({ data: { id: badge.id } });
            onChanged();
            onBack();
          }}
        >
          <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Verwijderen
        </Button>
      </header>

      <section className="space-y-2">
        <Label>Toekennen aan</Label>
        <UserSearch onPick={(u) => void toggle(u.userId, true)} />
      </section>

      <section className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Houders · {holders.length}</p>
        {holders.length === 0 && <p className="text-sm text-muted-foreground">Nog niemand heeft deze badge.</p>}
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {holders.map((h) => (
            <li key={h.userId} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>
                <span className="font-medium">@{h.username ?? h.userId.slice(0, 8)}</span>
                {h.displayName && <span className="pl-2 text-muted-foreground">{h.displayName}</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void toggle(h.userId, false)} aria-label={`Intrekken bij ${h.username}`}>
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** /admin/custom-badges — centraal beheer van familiewapens en bedrijfsemblemen. */
export default function AdminCustomBadges() {
  const list = useServerFn(adminListCustomBadges);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void list().then(setBadges).catch(() => toast.error("Geen toegang of laden mislukt"));
  }, [list]);
  useEffect(refresh, [refresh]);
  const current = badges.find((b) => b.id === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Eigen badges</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Familiewapens en bedrijfsemblemen. Ze verschijnen naast het blauwe vinkje of privacyschild, nooit in de plaats ervan.
        </p>
      </header>
      {current ? (
        <BadgeDetail badge={current} onBack={() => setSelected(null)} onChanged={refresh} />
      ) : (
        <>
          <NewBadgeForm onCreated={refresh} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {badges.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelected(b.id)}
                className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/40"
              >
                <BadgeEmblem badge={b} size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block text-xs text-muted-foreground">{b.holders} houder{b.holders === 1 ? "" : "s"}</span>
                </span>
              </button>
            ))}
            {badges.length === 0 && <p className="text-sm text-muted-foreground">Nog geen eigen badges.</p>}
          </div>
        </>
      )}
    </div>
  );
}

/** Blok in het gebruikersbeheer: één gebruiker kiezen en zijn eigen badges aan/uit zetten. */
export function UserCustomBadgesCard() {
  const list = useServerFn(adminListCustomBadges);
  const ofUser = useServerFn(adminUserCustomBadges);
  const setBadge = useServerFn(adminSetCustomBadge);
  const [all, setAll] = useState<Badge[]>([]);
  const [user, setUser] = useState<Found | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());

  useEffect(() => {
    void list().then(setAll).catch(() => setAll([]));
  }, [list]);
  useEffect(() => {
    if (!user) return;
    void ofUser({ data: { userId: user.userId } }).then((b) => setOwned(new Set(b.map((x) => x.id))));
  }, [user, ofUser]);

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Eigen badges per gebruiker</h2>
        <a href="/admin/custom-badges" className="text-sm underline">Alle eigen badges beheren</a>
      </div>
      <UserSearch onPick={setUser} />
      {user && (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">@{user.username}</span> — vink aan om toe te kennen. Het vinkje of schild blijft altijd behouden.
          </p>
          {all.length === 0 && <p className="text-sm text-muted-foreground">Maak eerst een badge aan.</p>}
          <div className="flex flex-wrap gap-2">
            {all.map((b) => {
              const on = owned.has(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={on}
                  onClick={async () => {
                    await setBadge({ data: { userId: user.userId, badgeId: b.id, granted: !on } });
                    setOwned((s) => {
                      const n = new Set(s);
                      if (on) n.delete(b.id);
                      else n.add(b.id);
                      return n;
                    });
                  }}
                  className={`flex items-center gap-2 rounded-full border px-2 py-1 text-sm ${on ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <BadgeEmblem badge={b} size={22} /> {b.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
