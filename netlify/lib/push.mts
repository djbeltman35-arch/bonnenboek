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
  if (!vapidReady()) return;
  const s = store();
  const { blobs } = await s.list({ prefix: `hh/${code}/push/` });
  await Promise.all(blobs.map(async (b) => {
    const rec = (await s.get(b.key, { type: "json" })) as any;
    if (!rec?.sub || String(rec.naam).toLowerCase() !== naam.toLowerCase()) return;
    try {
      await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await s.delete(b.key); // abonnement verlopen
      else console.error("push mislukt", e?.statusCode, e?.body);
    }
  }));
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
