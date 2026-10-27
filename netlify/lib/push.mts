import webpush from "web-push";
import { store, schoonInstellingen } from "./shared.mts";

const eur = (c: number) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(c / 100);

export function vapidReady() {
  const pub = Netlify.env.get("VAPID_PUBLIC_KEY"), priv = Netlify.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:erik@beltman.email", pub, priv);
  return true;
}

/** Stuurt een melding naar alle toestellen van een persoon in het huishouden. */
export async function meldPersoon(code: string, naam: string, payload: object) {
  const res = { toestellen: 0, verstuurd: 0, fouten: [] as string[], namen: [] as string[] };
  if (!vapidReady()) { res.fouten.push("geen VAPID-sleutels"); console.error("push: geen VAPID-sleutels"); return res; }
  const s = store();
  const { blobs } = await s.list({ prefix: `hh/${code}/push/` });
  await Promise.all(blobs.map(async (b) => {
    const rec = (await s.get(b.key, { type: "json", consistency: "strong" })) as any;
    if (!rec?.sub) return;
    res.namen.push(String(rec.naam));
    if (String(rec.naam).trim().toLowerCase() !== naam.trim().toLowerCase()) return;
    res.toestellen++;
    try {
      const r = await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 60 * 60 * 24, urgency: "high" });
      res.verstuurd++;
      console.log("push verstuurd", r?.statusCode, new URL(rec.sub.endpoint).host);
    } catch (e: any) {
      res.fouten.push(`${e?.statusCode ?? "?"} ${String(e?.body ?? e?.message ?? "").slice(0, 120)}`);
      console.error("push mislukt", e?.statusCode, e?.body ?? e?.message);
      if (e?.statusCode === 404 || e?.statusCode === 410) await s.delete(b.key); // abonnement verlopen
    }
  }));
  console.log("push resultaat", JSON.stringify({ naam, ...res }));
  return res;
}

/** Als een nieuwe bon onder een betaalregel valt, krijgt de betaler een melding. */
export async function meldBetaalverzoek(code: string, bon: any) {
  const inst = schoonInstellingen(((await store().get(`hh/${code}/instellingen`, { type: "json" })) as any) ?? {});
  const koper = String(bon.gekochtDoor || bon.door || "").toLowerCase();
  for (const r of inst.regels) {
    if (r.van.toLowerCase() !== koper || bon.aangemaakt < r.sinds) continue;
    const cent = Math.round((bon.totaalCent * r.pct) / 100);
    await meldPersoon(code, r.aan, {
      title: `Betaalverzoek van ${r.van}`,
      body: `${eur(cent)} voor ${bon.winkel} (${bon.datum.split("-").reverse().join("-")})`,
      url: "/#verzoeken",
    });
  }
}
