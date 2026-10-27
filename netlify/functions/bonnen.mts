import type { Config } from "@netlify/functions";
import { store, json, fout, normCode, huishouden, validId, schoonBon } from "../lib/shared.mts";

// Gedeelde bonnen van één huishouden. Elke bon is een eigen blob, zodat twee telefoons
// nooit elkaars wijzigingen overschrijven.
//   GET    /api/bonnen?code=…              -> { naam, budgetCent, index:[{id, etag}] }
//   POST   /api/bonnen  {code, ids:[…]}    -> { bonnen:[{id, etag, …}] }   (alleen gewijzigde ophalen)
//   PUT    /api/bonnen  {code, bon:{id,…}} -> { id, etag }
//   DELETE /api/bonnen?code=…&id=…         -> { ok }
//   PATCH  /api/bonnen  {code, budgetCent} -> { budgetCent }
export default async (req: Request) => {
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
    return json({
      naam: meta.naam,
      budgetCent: inst?.budgetCent ?? null,
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
    const { etag } = await s.setJSON(prefix + id, schoonBon(body.bon));
    return json({ id, etag });
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!validId(id)) return fout("Ongeldige bon.");
    await s.delete(prefix + id);
    return json({ ok: true });
  }

  if (req.method === "PATCH") {
    const c = body.budgetCent;
    const budgetCent = c === null ? null : Math.max(0, Math.round(Number(c) || 0)) || null;
    await s.setJSON(`hh/${code}/instellingen`, { budgetCent });
    return json({ budgetCent });
  }

  return fout("Methode niet toegestaan.", 405);
};

export const config: Config = {
  path: "/api/bonnen",
  method: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
