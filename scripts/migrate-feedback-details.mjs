/* Normalizes legacy feedback documents to the shared `details` field.
 * Existing `message` text is preserved in `details`, then the legacy field is
 * removed. Idempotent: documents already using `details` are left unchanged.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS.
 */
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const snap = await db.collection("feedback").get();
let updated = 0;

for (let offset = 0; offset < snap.docs.length; offset += 400) {
  const batch = db.batch();
  let writes = 0;
  for (const doc of snap.docs.slice(offset, offset + 400)) {
    const data = doc.data();
    if (Object.prototype.hasOwnProperty.call(data, "details") && !Object.prototype.hasOwnProperty.call(data, "message")) continue;
    batch.update(doc.ref, {
      details: data.details ?? data.message ?? "",
      message: admin.firestore.FieldValue.delete(),
    });
    writes += 1;
  }
  if (writes) {
    await batch.commit();
    updated += writes;
  }
}

console.log(JSON.stringify({ scanned: snap.size, updated, field: "details" }));
