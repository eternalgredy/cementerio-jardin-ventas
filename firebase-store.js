import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { firebaseCollections, firebaseConfig } from "./firebase-config.js";

const hasFirebaseConfig = Boolean(
  firebaseConfig?.apiKey &&
    firebaseConfig?.projectId &&
    firebaseConfig?.appId
);

let db = null;
let ready = Promise.resolve();
let initError = "";

if (hasFirebaseConfig) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    const auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    ready = signInAnonymously(auth);
  } catch (error) {
    initError = error?.message || "No se pudo iniciar Firebase";
  }
}

const lotsCollection = firebaseCollections?.lots || "nichos";
const historyCollection = firebaseCollections?.history || "historial";

function assertFirebase() {
  if (!db) {
    throw new Error(initError || "Firebase no esta configurado");
  }
}

async function ensureFirebase() {
  assertFirebase();
  await ready;
}

export const firebaseStore = {
  enabled: Boolean(db),
  reason: db ? "Firebase conectado" : initError || "Completa firebase-config.js",

  async getLots() {
    await ensureFirebase();
    const snapshot = await getDocs(collection(db, lotsCollection));
    return Object.fromEntries(
      snapshot.docs.map((item) => {
        const data = item.data();
        return [
          item.id,
          {
            status: data.status || "disponible",
            comprador: data.comprador || "",
            precio: data.precio || "",
            nota: data.nota || "",
            origen: data.origen || "",
            modifiedBy: data.modifiedBy || "",
            modifiedAt: data.modifiedAt || ""
          }
        ];
      })
    );
  },

  async saveLot(id, data) {
    await ensureFirebase();
    await setDoc(
      doc(db, lotsCollection, id),
      {
        ...data,
        firebaseUpdatedAt: serverTimestamp()
      },
      { merge: true }
    );
  },

  async getHistory() {
    await ensureFirebase();
    const historyQuery = query(
      collection(db, historyCollection),
      orderBy("firebaseCreatedAt", "desc"),
      limit(80)
    );
    const snapshot = await getDocs(historyQuery);
    return snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: data.id || "",
        status: data.status || "disponible",
        comprador: data.comprador || "",
        precio: data.precio || "",
        user: data.user || "",
        at: data.at || ""
      };
    });
  },

  async addHistory(entry) {
    await ensureFirebase();
    await addDoc(collection(db, historyCollection), {
      ...entry,
      firebaseCreatedAt: serverTimestamp()
    });
  },

  async clearHistory() {
    await ensureFirebase();
    const snapshot = await getDocs(collection(db, historyCollection));
    await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
  }
};
