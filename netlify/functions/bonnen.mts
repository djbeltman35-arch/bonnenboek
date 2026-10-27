import type { Config, Context } from "@netlify/functions";
import { store, json, fout, normCode, huishouden, validId, schoonBon, schoonInstellingen } from "../lib/shared.mts";
import { meldBetaalverzoek } from "../lib/push.mts";

// Gedeelde bonnen van één huishouden. Elke bon is een eigen blob, zodat twee telefoons
// nooit elkaars wijzigingen overschrijven.
//   GET    /api/bonnen?code=…              -> { naam, budgetCent, index:[{id, etag}] }
//   POST   /api/bonnen  {code, ids:[…]}    -> { bonnen:[{id, etag, …}] }   (alleen gewijzigde ophalen)
//   PUT    /api/bonnen  {code, bon:{id,…}} -> { id, etag }
//   DELETE /api/bonnen?code=…&id=…         -> { ok }
//   PATCH  /api/bonnen  {code, instellingen:{…}} -> instellingen  (budget, betaalregels, rekeningen; samengevoegd)
export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const body: any = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : {};
  const code = normCode(body.code ?? url.searchParams.get("code"));
  const meta = await huishouden(code);
  if (!meta) return fout("Onbekende huishoudcode.", 404);
  const s = store();
  const prefix = `hh/${code}/bon/`;

  if (req.method === "GET") {
    const [{ blobs }, inst] = await Promise.all([
      s.list({ prefix }),
      s.get(`hh/${code}/instellingen`, { type: "json" }) as Promise<any>,
    ]);
    const ci = schoonInstellingen(inst ?? {});
    return json({
      naam: meta.naam,
      budgetCent: ci.budgetCent,
      regels: ci.regels,
      rekeningen: ci.rekeningen,
      index: blobs.map((b) => ({ id: b.key.slice(prefix.length), etag: b.etag })),
    });
  }

  if (req.method === "POST") {
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : []).filter(validId).slice(0, 200);
    const bonnen = (
      await Promise.all(
        ids.map(async (id) => {
          const r = await s.getWithMetadata(prefix + id, { type: "json" });
          return r ? { ...(r.data as object), id, etag: r.etag } : null;
        }),
      )
    ).filter(Boolean);
    return json({ bonnen });
  }

  if (req.method === "PUT") {
    const id = body?.bon?.id;
    if (!validId(id)) return fout("Ongeldige bon.");
    const bestond = await s.getMetadata(prefix + id);
    const bon = schoonBon(body.bon);
    const { etag } = await s.setJSON(prefix + id, bon);
    if (!bestond) context.waitUntil(meldBetaalverzoek(code!, bon).catch((e) => console.error("melding mislukt", e)));
    return json({ id, etag });
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!validId(id)) return fout("Ongeldige bon.");
    await s.delete(prefix + id);
    return json({ ok: true });
  }

  if (req.method === "PATCH") {
    const huidig = ((await s.get(`hh/${code}/instellingen`, { type: "json" })) as any) ?? {};
    const wijziging = body.instellingen ?? ("budgetCent" in body ? { budgetCent: body.budgetCent } : {});
    const nieuw = schoonInstellingen({
      ...huidig, ...wijziging,
      rekeningen: { ...(huidig.rekeningen ?? {}), ...(wijziging.rekeningen ?? {}) },
    });
    await s.setJSON(`hh/${code}/instellingen`, nieuw);
    return json(nieuw);
  }

  return fout("Methode niet toegestaan.", 405);
};

export const config: Config = {
  path: "/api/bonnen",
  method: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
