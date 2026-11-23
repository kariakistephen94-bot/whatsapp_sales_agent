import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";
import { from, run, maybe } from "@/server/db";
import { encrypt, decrypt } from "@/server/crypto";

/**
 * Baileys auth state persisted (AES-GCM encrypted) in WhatsappConnection.credsEncrypted,
 * so sessions survive restarts and never touch the local disk or the browser.
 */
export async function useDbAuthState(connectionId: string) {
  const row = await maybe<{ credsEncrypted: string | null }>(from("WhatsappConnection").select("credsEncrypted").eq("id", connectionId).maybeSingle());
  let blob: { creds: any; keys: Record<string, any> } = { creds: null, keys: {} };
  if (row?.credsEncrypted) {
    blob = JSON.parse(decrypt(row.credsEncrypted), BufferJSON.reviver);
  }
  const creds = blob.creds ?? initAuthCreds();
  const keys = blob.keys ?? {};

  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    timer = null;
    const data = encrypt(JSON.stringify({ creds, keys }, BufferJSON.replacer));
    await run(from("WhatsappConnection").update({ credsEncrypted: data }).eq("id", connectionId));
  };
  const save = () => { if (!timer) timer = setTimeout(() => void flush().catch((e) => console.error("saving WhatsApp keys failed", e?.message)), 300); };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          let v = keys[`${type}:${id}`];
          if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
          if (v) out[id] = v;
        }
        return out;
      },
      set: async (data) => {
        for (const type in data) {
          for (const id in (data as any)[type]) {
            const v = (data as any)[type][id];
            if (v) keys[`${type}:${id}`] = v; else delete keys[`${type}:${id}`];
          }
        }
        save();
      },
    },
  };
  // Creds change rarely but are critical (pairing!), so persist them immediately, not debounced.
  // Right after a QR scan WhatsApp forces a socket restart (515); stale creds there would lose the pairing.
  return { state, saveCreds: async () => { if (timer) clearTimeout(timer); await flush(); }, flushNow: flush };
}
