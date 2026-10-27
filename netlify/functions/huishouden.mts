import type { Config } from "@netlify/functions";
import { store, json, fout, normCode, huishouden, nieuweCode } from "../lib/shared.mts";

// POST /api/huishouden  {naam}        -> maakt een nieuw huishouden en geeft de code terug
// GET  /api/huishouden?code=XXXX-XXXX -> controleert de code (om mee te doen)
export default async (req: Request) => {
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const naam = String(body?.naam ?? "").trim().slice(0, 60) || "Ons huishouden";
    const s = store();
    for (let i = 0; i < 5; i++) {
      const code = nieuweCode();
      const { modified } = await s.setJSON(
        `hh/${code}/meta`,
        { naam, aangemaakt: new Date().toISOString() },
        { onlyIfNew: true },
      );
      if (modified) return json({ code, naam }, 201);
    }
    return fout("Kon geen nieuwe code maken. Probeer het opnieuw.", 500);
  }

  const code = normCode(new URL(req.url).searchParams.get("code"));
  const meta = await huishouden(code);
  if (!meta) return fout("Deze huishoudcode bestaat niet. Controleer de code.", 404);
  return json({ code, naam: meta.naam });
};

export const config: Config = {
  path: "/api/huishouden",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
