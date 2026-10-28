import type { Config } from "@netlify/functions";
import { store, json, fout, toegang } from "../lib/shared.mts";
import { meldPersoon } from "../lib/push.mts";

// GET    /api/push                          -> { publicKey }
// POST   /api/push {naam, sub}        -> meldingen aan voor dit toestel
// DELETE /api/push {endpoint}         -> meldingen uit
// PUT    /api/push {naam}             -> testmelding
async function sleutel(endpoint: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  if (req.method === "GET") {
    const publicKey = Netlify.env.get("VAPID_PUBLIC_KEY");
    return publicKey ? json({ publicKey }) : fout("Meldingen zijn nog niet ingesteld op deze site.", 503);
  }
  const t = await toegang(req); if (t instanceof Response) return t;
  const code = t.id;
  const body: any = await req.json().catch(() => ({}));
  const s = store();

  if (req.method === "POST") {
    const sub = body.sub;
    // Alleen echte pushdiensten van Google, Apple, Mozilla en Microsoft (geen willekeurige adressen).
    let host = "";
    try { const u = new URL(String(sub?.endpoint)); if (u.protocol === "https:") host = u.hostname; } catch {}
    const toegestaan = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
    if (!toegestaan.test(host) || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string")
      return fout("Ongeldig abonnement.");
    const naam = String(body.naam ?? "").trim().slice(0, 40);
    if (!naam) return fout("Stel eerst je naam in.");
    const { blobs } = await s.list({ prefix: `hh/${code}/push/` });
    if (blobs.length >= 30) return fout("Er zijn al te veel toestellen aangemeld voor meldingen.", 429);
    const schoon = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) } };
    await s.setJSON(`hh/${code}/push/${await sleutel(sub.endpoint)}`, { naam, sub: schoon, sinds: new Date().toISOString() });
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    if (body.endpoint) await s.delete(`hh/${code}/push/${await sleutel(String(body.endpoint))}`);
    return json({ ok: true });
  }
  if (req.method === "PUT") {
    const eur = (c: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(c / 100);
    const bericht = body.soort === "betaald"
      ? {
          title: `${String(body.van ?? "Iemand").slice(0, 40)} heeft betaald`,
          body: `${eur(Math.max(0, Math.round(Number(body.cent) || 0)))} voor ${Math.max(1, Math.round(Number(body.aantal) || 1))} bon${Number(body.aantal) > 1 ? "nen" : ""} is op betaald gezet.`,
          url: "/#verzoeken",
        }
      : { title: "Bonnenboek", body: "Meldingen staan aan op dit toestel.", url: "/#overzicht" };
    const r = await meldPersoon(code!, String(body.naam ?? ""), bericht);
    return json(r);
  }
  return fout("Methode niet toegestaan.", 405);
};

export const config: Config = {
  path: "/api/push",
  method: ["GET", "POST", "DELETE", "PUT"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
