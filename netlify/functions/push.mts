import type { Config } from "@netlify/functions";
import { store, json, fout, normCode, huishouden } from "../lib/shared.mts";
import { meldPersoon } from "../lib/push.mts";

// GET    /api/push                          -> { publicKey }
// POST   /api/push {code, naam, sub}        -> meldingen aan voor dit toestel
// DELETE /api/push {code, endpoint}         -> meldingen uit
// PUT    /api/push {code, naam}             -> testmelding
async function sleutel(endpoint: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  if (req.method === "GET") {
    const publicKey = Netlify.env.get("VAPID_PUBLIC_KEY");
    return publicKey ? json({ publicKey }) : fout("Meldingen zijn nog niet ingesteld op deze site.", 503);
  }
  const body: any = await req.json().catch(() => ({}));
  const code = normCode(body.code);
  if (!(await huishouden(code))) return fout("Onbekende huishoudcode.", 404);
  const s = store();

  if (req.method === "POST") {
    const sub = body.sub;
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return fout("Ongeldig abonnement.");
    const naam = String(body.naam ?? "").trim().slice(0, 40);
    if (!naam) return fout("Stel eerst je naam in.");
    await s.setJSON(`hh/${code}/push/${await sleutel(sub.endpoint)}`, { naam, sub, sinds: new Date().toISOString() });
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    if (body.endpoint) await s.delete(`hh/${code}/push/${await sleutel(String(body.endpoint))}`);
    return json({ ok: true });
  }
  if (req.method === "PUT") {
    const r = await meldPersoon(code!, String(body.naam ?? ""), { title: "Bonnenboek", body: "Meldingen staan aan op dit toestel.", url: "/#overzicht" });
    return json(r);
  }
  return fout("Methode niet toegestaan.", 405);
};

export const config: Config = {
  path: "/api/push",
  method: ["GET", "POST", "DELETE", "PUT"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
