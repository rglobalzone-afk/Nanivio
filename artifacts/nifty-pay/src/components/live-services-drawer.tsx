import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Radio, Sparkles } from "lucide-react";
import { API_BASE as API } from "@/lib/api";

type LiveService = {
  id: number;
  title: string;
  description?: string | null;
  category: string;
  businessName?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
};

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("nanivio_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Small, deliberately independent catalog surface for active calls. */
export function LiveServicesDrawer() {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<LiveService[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (!open || state !== "idle") return;
    let cancelled = false;
    setState("loading");
    fetch(`${API}/live-services`, { headers: authHeaders() })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to load live services.");
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setServices(Array.isArray(data.services) ? data.services : []);
          setState("ready");
        }
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [open, state]);

  const retry = () => setState("idle");

  return (
    <section className="absolute inset-x-3 bottom-[6.75rem] z-20 mx-auto max-w-xl text-white">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/85 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="live-services-content"
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-cyan-300" /> Smart Live Services
            {state === "ready" && services.length > 0 && <span className="text-xs font-normal text-white/45">({services.length})</span>}
          </span>
          {open ? <ChevronDown className="h-4 w-4 text-white/60" /> : <ChevronUp className="h-4 w-4 text-white/60" />}
        </button>

        {open && (
          <div id="live-services-content" className="border-t border-white/10 px-3 pb-3 pt-2">
            {state === "loading" && (
              <div className="flex items-center justify-center gap-2 py-5 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding live services…
              </div>
            )}
            {state === "error" && (
              <div className="py-4 text-center text-sm text-white/65">
                <p>Live services are unavailable right now.</p>
                <button type="button" onClick={retry} className="mt-2 font-semibold text-cyan-300 hover:text-cyan-200">Try again</button>
              </div>
            )}
            {state === "ready" && services.length === 0 && (
              <div className="flex items-center gap-3 py-4 text-sm text-white/55">
                <Radio className="h-4 w-4 text-white/35" />
                <span>No live services are available for this call.</span>
              </div>
            )}
            {state === "ready" && services.length > 0 && (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {services.map((service) => (
                  <article key={service.id} className="min-w-[220px] max-w-[260px] overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
                    {service.imageUrl && <img src={service.imageUrl} alt="" className="h-20 w-full object-cover" />}
                    <div className="p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">{service.category}</p>
                      <h3 className="mt-1 text-sm font-bold">{service.title}</h3>
                      {service.businessName && <p className="mt-0.5 text-xs text-white/55">{service.businessName}</p>}
                      {service.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/65">{service.description}</p>}
                      {service.ctaUrl && service.ctaLabel && (
                        <a href={service.ctaUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/25">
                          {service.ctaLabel} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}