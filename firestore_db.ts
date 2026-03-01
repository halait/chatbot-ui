import app from './firebase.js'
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore'


const db = getFirestore(app)

export async function main() {
  // console.log('hey')
  // const querySnapshot = await getDocs(collection(db, "chats"));
  // querySnapshot.forEach((doc) => {
  //   console.log(`${doc.id} => ${doc.data()}`);
  // });
  // console.log('done')
}
