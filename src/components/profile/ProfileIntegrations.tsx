import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { BrandIcon } from "@/components/integrations/BrandIcon";
import { integrationById } from "@/lib/integrations-catalog";
import { paymentUri } from "@/lib/integrations-rules";
import { proxied } from "@/lib/image-proxy-rules";

type Item = {
  provider: string;
  handle: string;
  verified: boolean;
  status: { title?: string; subtitle?: string; url?: string; image?: string | null } | null;
};
type Theme = { card: string; border: string; text: string; muted: string };

/** Live connection cards on a public profile. External images go through the privacy proxy. */
export function ProfileIntegrations({ handle, theme, mode = null }: { handle: string; theme: Theme; mode?: "pro" | "social" | null }) {
  const q = useQuery({
    queryKey: ["profile-integrations", handle, mode],
    queryFn: async (): Promise<Item[]> => {
      const r = await fetch(`/api/public/integrations?handle=${encodeURIComponent(handle)}${mode ? `&mode=${mode}` : ""}`);
      return r.ok ? ((await r.json()) as { items: Item[] }).items : [];
    },
    staleTime: 60_000,
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <div className="mt-4 grid w-full max-w-sm gap-2">
      {items.map((it) => (
        <Card key={it.provider} item={it} theme={theme} />
      ))}
    </div>
  );
}

function Card({ item, theme }: { item: Item; theme: Theme }) {
  const meta = integrationById(item.provider);
  const [showQr, setShowQr] = useState(false);
  const pay = paymentUri(item.provider, item.handle);
  const img = proxied(item.status?.image);
  const body = (
    <div className="flex items-center gap-3 rounded-2xl p-2.5 pr-4" style={{ background: theme.card, border: `1px solid ${theme.border}`, color: theme.text }}>
      {img ? (
        <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ border: `1px solid ${theme.border}` }}>
          <BrandIcon icon={meta?.icon ?? null} className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider" style={{ color: theme.muted }}>
          {meta?.label ?? item.provider}
          {item.verified && <BadgeCheck className="h-3 w-3" aria-label="Geverifieerd account" />}
        </span>
        <span className="block truncate text-sm font-medium">{pay ? "Steun mij" : item.status?.title ?? item.handle}</span>
        <span className="block truncate text-xs" style={{ color: theme.muted }}>
          {pay ? item.handle : item.status?.subtitle ?? ""}
        </span>
      </span>
      {pay && <QrCode className="h-4 w-4 shrink-0" aria-hidden />}
    </div>
  );
  if (pay) {
    return (
      <div>
        <button type="button" className="w-full" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr} aria-label={`${meta?.label} QR-code tonen`}>
          {body}
        </button>
        {showQr && (
          <div className="mt-2 flex flex-col items-center gap-2 rounded-2xl p-3" style={{ background: theme.card, border: `1px solid ${theme.border}` }}>
            <div className="rounded-lg bg-background p-2">
              <QRCodeSVG value={pay} size={160} />
            </div>
            <a href={pay} className="text-xs underline" style={{ color: theme.text }}>
              Open in wallet
            </a>
          </div>
        )}
      </div>
    );
  }
  return item.status?.url ? (
    <a href={item.status.url} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}
