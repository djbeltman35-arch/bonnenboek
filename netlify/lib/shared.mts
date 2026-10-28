import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

export const store = () => getStore({ name: "bonnenboek", consistency: "strong" });

const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const ID_RE = /^[a-z0-9-]{6,64}$/;

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });

export const fout = (bericht: string, status = 400) => json({ fout: bericht }, status);

export function normCode(c: unknown): string | null {
  const s = String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 8) return null;
  const code = s.slice(0, 4) + "-" + s.slice(4);
  return CODE_RE.test(code) ? code : null;
}

export const validId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

export type Meta = { naam: string; aangemaakt: string; token?: string; code?: string; codeVervangen?: boolean };
const HH_RE = /^(?:[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}|h[0-9a-f]{24})$/;

export const nieuwToken = () => {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const nieuwId = () => {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return "h" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};
export const metaVan = async (id: string) => (await store().get(`hh/${id}/meta`, { type: "json" })) as Meta | null;

/** Zoekt bij een uitnodigingscode het huishouden. Oude huishoudens gebruiken hun code als id. */
export async function zoekCode(code: string | null): Promise<{ id: string; meta: Meta } | null> {
  if (!code) return null;
  const s = store();
  const link = (await s.get(`code/${code}`, { type: "json" })) as { id: string } | null;
  if (link?.id) { const meta = await metaVan(link.id); return meta ? { id: link.id, meta } : null; }
  const meta = await metaVan(code);
  if (meta && !meta.codeVervangen && (!meta.code || meta.code === code)) return { id: code, meta };
  return null;
}

/** Controleert de toegangssleutel van het toestel. Geeft het huishouden terug, of een foutantwoord. */
export async function toegang(req: Request): Promise<{ id: string; meta: Meta } | Response> {
  const id = req.headers.get("x-huishouden") ?? "";
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!HH_RE.test(id) || token.length < 40) return fout("Dit toestel is niet aangemeld. Doe opnieuw mee met de code van je huishouden.", 401);
  const meta = await metaVan(id);
  const a = new TextEncoder().encode(token), b = new TextEncoder().encode(meta?.token ?? "");
  if (!meta || !meta.token || a.length !== b.length || !timingSafeEqual(a, b))
    return fout("Dit toestel is afgemeld. Vraag de code van je huishouden en doe opnieuw mee.", 401);
  return { id, meta };
}

export const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function nieuweCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  const s = Array.from(buf, (b) => abc[b % abc.length]).join("");
  return s.slice(0, 4) + "-" + s.slice(4);
}

export const CATS = [
  "Groente & fruit", "Zuivel & eieren", "Vlees & vis", "Vega & alternatieven", "Brood & bakkerij",
  "Droge waren", "Diepvries", "Dranken", "Snacks & snoep", "Ontbijt & beleg", "Verzorging",
  "Huishouden", "Baby & kind", "Dier", "Statiegeld", "Korting", "Overig",
];

/** Cleans a receipt sent by a client so only known fields of the right type are stored. */
export function schoonBon(b: any) {
  const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
  const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(b?.datum) ? b.datum : new Date().toISOString().slice(0, 10);
  const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 300).map((i: any) => ({
    naam: str(i?.naam, 120),
    aantal: Math.max(0, Number(i?.aantal) || 1),
    cent: int(i?.cent),
    cat: CATS.includes(i?.cat) ? i.cat : "Overig",
  }));
  return {
    winkel: str(b?.winkel, 80) || "Onbekend",
    datum,
    totaalCent: int(b?.totaalCent),
    items,
    betaalwijze: ["pin", "contant", "creditcard", "anders"].includes(b?.betaalwijze) ? b.betaalwijze : "",
    bron: b?.bron === "scan" ? "scan" : "handmatig",
    door: str(b?.door, 40),
    betaaldDoor: str(b?.betaaldDoor ?? b?.door, 40),
    gekochtDoor: str(b?.gekochtDoor ?? b?.door, 40),
    verrekend: b?.verrekend && typeof b.verrekend === "object"
      ? { op: str(b.verrekend.op, 40), door: str(b.verrekend.door, 40) }
      : null,
    aangemaakt: str(b?.aangemaakt, 40) || new Date().toISOString(),
    gewijzigd: new Date().toISOString(),
  };
}

/** Household settings: budget, payment-request rules and bank accounts. */
export function schoonInstellingen(i: any) {
  const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  const budget = i?.budgetCent === null ? null : Math.max(0, Math.round(Number(i?.budgetCent) || 0)) || null;
  const regels = (Array.isArray(i?.regels) ? i.regels : []).slice(0, 10)
    .map((r: any) => ({
      van: str(r?.van, 40), aan: str(r?.aan, 40),
      pct: Math.min(100, Math.max(1, Math.round(Number(r?.pct) || 100))),
      sinds: str(r?.sinds, 40) || new Date().toISOString(),
    }))
    .filter((r: any) => r.van && r.aan && r.van.toLowerCase() !== r.aan.toLowerCase());
  const rekeningen: Record<string, { iban: string; tnv: string }> = {};
  for (const [naam, r] of Object.entries(i?.rekeningen ?? {}).slice(0, 20) as any) {
    const n = str(naam, 40); if (!n) continue;
    rekeningen[n] = { iban: str(r?.iban, 40).toUpperCase().replace(/\s+/g, ""), tnv: str(r?.tnv, 60) };
  }
  return { budgetCent: budget, regels, rekeningen };
}
