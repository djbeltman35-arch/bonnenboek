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

  const files: string[] = (Array.isArray(body.images) ? body.images : []).slice(0, 4);
  const blocks: any[] = [];
  for (const d of files) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,(.+)$/.exec(String(d));
    if (!m || m[2].length < 4000) continue; // lege of piepkleine afbeelding
    if (m[1] === "application/pdf")
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: m[2] } });
    else blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  let pasted = String(body.text ?? "").slice(0, 30000).trim();
  if (/^function \w*\(\)\s*\{\s*\[native code\]\s*\}$/.test(pasted)) pasted = ""; // oude app-versie stuurde dit per ongeluk mee
  if (pasted) blocks.push({ type: "text", text: "Tekst van de bon (geplakt door de gebruiker):\n\n" + pasted });
  console.log("scan", JSON.stringify({ fotos: blocks.filter((b) => b.type === "image").length, pdf: blocks.filter((b) => b.type === "document").length, tekst: pasted.length, kb: Math.round(files.join("").length / 1024) }));
  if (!blocks.length) return fout("De foto is niet goed aangekomen. Sluit Bonnenboek helemaal af, open hem opnieuw en probeer het nog eens.", 400);

  const vandaag = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  const prompt = `Hierboven staat één kassabon (meestal Nederlands, Belgisch of Duits): een foto van een papieren bon, een schermafbeelding of PDF van een digitale bon uit de app of e-mail van de winkel, of geplakte tekst. Meerdere delen horen samen bij dezelfde bon. Lees de bon zorgvuldig uit.
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
- "betaalwijze": "pin", "contant", "creditcard", "anders" of null. iDEAL, incasso of betalen via een app is "anders".
- Online boodschappen (zoals Picnic, AH thuisbezorgd, Jumbo bezorgen, Crisp): gebruik de leverdatum als datum, de bezorgdienst als winkel (bijv. "Picnic"), en neem bezorg- of servicekosten op als regel met categorie "Overig".
- Een bon of factuur kan meerdere pagina's hebben: neem alle producten van alle pagina's mee.
- Elke aankoopbon telt, ook van een tankstation, drogisterij, bakker, markt of webwinkel. Brandstof krijgt categorie "Overig".
- Alleen als er echt geen bon of aankoop te zien is: {"isBon":false}.`;

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
