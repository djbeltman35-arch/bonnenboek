import type { Config } from "@netlify/functions";
import Anthropic from "@anthropic-ai/sdk";
import { json, fout, normCode, huishouden, CATS } from "../lib/shared.mts";

// POST /api/scan  {code, images:["data:image/jpeg;base64,…", …]}
// Leest een kassabon uit via Claude (Netlify AI Gateway) en geeft gestructureerde gegevens terug.
export default async (req: Request) => {
  const body: any = await req.json().catch(() => ({}));
  if (!(await huishouden(normCode(body.code)))) return fout("Onbekende huishoudcode.", 404);
  if (!Netlify.env.get("ANTHROPIC_API_KEY") && !Netlify.env.get("ANTHROPIC_BASE_URL"))
    return fout("Automatisch uitlezen is nog niet actief op deze site.", 503);

  const images: string[] = (Array.isArray(body.images) ? body.images : []).slice(0, 4);
  const blocks = images
    .map((d) => /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(d)))
    .filter(Boolean)
    .map((m) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: m![1] as "image/jpeg", data: m![2] },
    }));
  if (!blocks.length) return fout("Geen foto ontvangen.");

  const vandaag = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const prompt = `Je ziet ${blocks.length > 1 ? blocks.length + " foto's van één lange" : "een foto van een"} kassabon (meestal Nederlands, Belgisch of Duits). Lees de bon zorgvuldig uit.
Geef ALLEEN een JSON-object terug, zonder uitleg of codeblok, in exact dit formaat:
{"isBon":true,"winkel":"Albert Heijn","datum":"2026-10-25","totaal":34.56,"betaalwijze":"pin","items":[{"naam":"Halfvolle melk 1L","aantal":2,"prijs":2.38,"categorie":"Zuivel & eieren"}]}
Regels:
- "totaal": het eindbedrag dat werkelijk betaald is (na kortingen), getal in euro met punt als decimaalteken.
- "datum" als JAAR-MAAND-DAG; vandaag is ${vandaag}. Onleesbaar: null.
- "winkel": de keten of winkelnaam, kort (bijv. "Jumbo", "Lidl", "Albert Heijn"), zonder filiaal of adres.
- Elk product één regel. "prijs" is het regelbedrag (aantal × stukprijs). Maak productnamen leesbaar, schrijf duidelijke afkortingen voluit.
- Kortingen, bonus, actie of "uw voordeel" als aparte regel met NEGATIEVE prijs en categorie "Korting". Statiegeld als regel met categorie "Statiegeld" (ingeleverd statiegeld negatief).
- Geen regels voor subtotaal, totaal, btw, wisselgeld, betaling of spaarpunten.
- "categorie" is precies één van: ${CATS.join(" | ")}.
- "betaalwijze": "pin", "contant", "creditcard", "anders" of null.
- Is het geen kassabon: {"isBon":false}.`;

  try {
    const anthropic = new Anthropic({ timeout: 55_000, maxRetries: 0 });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 6000,
      messages: [{ role: "user", content: [...blocks, { type: "text", text: prompt }] }],
    });
    const text = msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return fout("De bon kon niet worden gelezen.", 422);
    return json(JSON.parse(text.slice(start, end + 1)));
  } catch (e: any) {
    console.error("scan mislukt", e?.status, e?.message);
    if (e?.name === "APIConnectionTimeoutError" || /timeout/i.test(String(e?.message)))
      return fout("Uitlezen duurde te lang. Probeer een scherpere foto of minder foto's tegelijk.", 504);
    return fout("Uitlezen lukte niet. Probeer het opnieuw of voer de bon handmatig in.", 502);
  }
};

export const config: Config = {
  path: "/api/scan",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
