import { db, collection, getDocs, doc, setDoc } from '../lib/dbProxy';

/**
 * Extracts the base name by removing a trailing single uppercase letter (A-Z) suffix.
 * e.g., "张大帅A" -> "张大帅", "张大帅" -> "张大帅"
 */
export function getBaseName(name: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)[A-Z]$/);
  return match ? match[1] : trimmed;
}

/**
 * Scans all online applications, groups duplicate names, and resolves suffixes ('A', 'B', 'C'...)
 * based on their registration order (createdAt). It then updates the Firestore documents in
 * both `online_applications` and `driver_users` to keep everything in real-time sync.
 */
export async function resolveAndSyncDuplicateNames(): Promise<void> {
  try {
    const q = collection(db, 'online_applications');
    const snapshot = await getDocs(q);
    const docsList: any[] = [];
    
    snapshot.forEach((docSnap) => {
      docsList.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (docsList.length === 0) return;

    // Group documents by their normalized base name
    const groups: { [key: string]: any[] } = {};
    docsList.forEach(app => {
      const name = app.driverName || '未命名';
      const base = getBaseName(name);
      if (!groups[base]) {
        groups[base] = [];
      }
      groups[base].push(app);
    });

    // Process each name group
    for (const base of Object.keys(groups)) {
      const list = groups[base];
      
      if (list.length > 1) {
        // There are duplicates! Sort chronologically by registration time (createdAt)
        list.sort((a, b) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          if (timeA !== timeB) return timeA - timeB;
          return a.id.localeCompare(b.id);
        });

        for (let i = 0; i < list.length; i++) {
          const app = list[i];
          const expectedName = base + String.fromCharCode(65 + i); // 65 is 'A', then 'B', 'C'...
          
          if (app.driverName !== expectedName) {
            // Update in online_applications
            const appRef = doc(db, 'online_applications', app.id);
            await setDoc(appRef, {
              driverName: expectedName,
              updatedAt: new Date().toISOString()
            }, { merge: true });

            // Sync with driver_users if approved
            const driverRef = doc(db, 'driver_users', app.id);
            await setDoc(driverRef, {
              driverName: expectedName,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        }
      } else {
        // Only a single driver has this base name. Remove any trailing A-Z suffix if present
        const app = list[0];
        if (app.driverName !== base) {
          // Update in online_applications
          const appRef = doc(db, 'online_applications', app.id);
          await setDoc(appRef, {
            driverName: base,
            updatedAt: new Date().toISOString()
            }, { merge: true });

          // Sync with driver_users
          const driverRef = doc(db, 'driver_users', app.id);
          await setDoc(driverRef, {
            driverName: base,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
    }
  } catch (error) {
    console.error("Error resolving duplicate driver names:", error);
  }
}
