import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicCustomBadges } from "@/lib/custom-badges.functions";

type Item = Awaited<ReturnType<typeof getPublicCustomBadges>>[number];

/** Eigen badges (familiewapen, bedrijfsembleem): additief naast vinkje of schild. */
export function CustomBadgeRow({ handle, mutedColor }: { handle: string | null | undefined; mutedColor?: string }) {
  const load = useServerFn(getPublicCustomBadges);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    void load({ data: { handle } })
      .then((r) => alive && setItems(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [handle, load]);
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap items-center justify-center gap-1.5" aria-label="Eigen badges">
      {items.map((b) => (
        <li key={b.slug} title={b.description ? `${b.name} — ${b.description}` : b.name}>
          {b.imageUrl ? (
            <img src={b.imageUrl} alt={b.name} width={24} height={24} loading="lazy" className="h-6 w-6 rounded object-contain" />
          ) : (
            <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ color: mutedColor }}>
              {b.name}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
