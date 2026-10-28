import type { Config } from "@netlify/functions";
import { store, json, fout, normCode, nieuweCode, zoekCode, toegang, nieuwToken, nieuwId, wacht } from "../lib/shared.mts";

// POST  /api/huishouden {naam}             -> nieuw huishouden: { id, code, naam, token }
// GET   /api/huishouden?code=XXXX-XXXX     -> meedoen met een code: { id, code, naam, token }
// PATCH /api/huishouden {actie}  (aangemeld) -> "nieuweCode": nieuwe uitnodigingscode (oude werkt niet meer)
//                                              "afmelden":   nieuwe sleutel, alle andere toestellen afgemeld
async function koppelCode(id: string) {
  const s = store();
  for (let i = 0; i < 8; i++) {
    const code = nieuweCode();
    if (await s.getMetadata(`hh/${code}/meta`)) continue; // botst met een oud huishouden
    const { modified } = await s.setJSON(`code/${code}`, { id }, { onlyIfNew: true });
    if (modified) return code;
  }
  throw new Error("geen vrije code");
}

export default async (req: Request) => {
  const s = store();

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const naam = String(body?.naam ?? "").trim().slice(0, 60) || "Ons huishouden";
    const id = nieuwId(), token = nieuwToken();
    try {
      const code = await koppelCode(id);
      await s.setJSON(`hh/${id}/meta`, { naam, aangemaakt: new Date().toISOString(), token, code });
      return json({ id, code, naam, token }, 201);
    } catch { return fout("Kon geen nieuwe code maken. Probeer het opnieuw.", 500); }
  }

  if (req.method === "GET") {
    const code = normCode(new URL(req.url).searchParams.get("code"));
    const hit = await zoekCode(code);
    if (!hit) { await wacht(800); return fout("Deze code bestaat niet of is vervangen. Controleer de 8 tekens.", 404); }
    let { meta } = hit;
    if (!meta.token) {
      // Oud huishouden zonder sleutel: maak er eenmalig een (veilig als twee toestellen tegelijk meedoen).
      const cur = await s.getWithMetadata(`hh/${hit.id}/meta`, { type: "json" });
      const nieuw = { ...(cur?.data as any), token: nieuwToken(), code: code! };
      const { modified } = await s.setJSON(`hh/${hit.id}/meta`, nieuw, cur?.etag ? { onlyIfMatch: cur.etag } : {});
      meta = modified ? nieuw : ((await s.get(`hh/${hit.id}/meta`, { type: "json" })) as any);
    }
    return json({ id: hit.id, code, naam: meta.naam, token: meta.token });
  }

  if (req.method === "PATCH") {
    const t = await toegang(req); if (t instanceof Response) return t;
    const { id, meta } = t;
    const body: any = await req.json().catch(() => ({}));
    if (body.actie === "nieuweCode") {
      const oud = meta.code ?? id;
      const code = await koppelCode(id);
      await s.setJSON(`hh/${id}/meta`, { ...meta, code, codeVervangen: true });
      if (oud !== id) await s.delete(`code/${oud}`);
      return json({ code });
    }
    if (body.actie === "afmelden") {
      const token = nieuwToken();
      await s.setJSON(`hh/${id}/meta`, { ...meta, token });
      return json({ token });
    }
    return fout("Onbekende actie.");
  }
  return fout("Methode niet toegestaan.", 405);
};

export const config: Config = {
  path: "/api/huishouden",
  method: ["GET", "POST", "PATCH"],
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
