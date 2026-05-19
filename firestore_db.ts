import app from "./firebase.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  getDoc,
  addDoc,
} from "firebase/firestore";

const db = getFirestore(app);

export async function set(table: string, data: any, key?: string) {
  if (key) {
    await setDoc(doc(db, table, key), data);
    return key;
  } else {
    const docRef = await addDoc(collection(db, table), data);
    return docRef.id;
  }
}

export async function get(table: string, key: string) {
  const docSnap = await getDoc(doc(db, table, key));

  if (docSnap.exists()) {
    return docSnap.data();
  } else {
    return null;
  }
}
