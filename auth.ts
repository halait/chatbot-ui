import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  User,
} from "firebase/auth";
import app from "./firebase.js";
import { toggleModal } from "./modal.js";
import {
  jwkToCryptoKey,
  cryptoKeyToJwk,
  deriveKEK,
  generateDEK,
  generateRandomBytes,
  unwrapDEK,
  wrapDEK,
} from "./crypto.js";
import { Bytes } from "firebase/firestore";
import { set, get } from "./firestore_db.js";

const auth = getAuth(app);
let uidDek: {
  uid: string;
  dek: CryptoKey;
} | null = null;

function clearUidDek() {
  uidDek = null;
  localStorage.removeItem("uidDek");
}

async function setUidDek(uid: string, dek: CryptoKey) {
  uidDek = { uid, dek };
  localStorage.setItem(
    "uidDek",
    JSON.stringify({ uid, dek: await cryptoKeyToJwk(dek) }),
  );
}

export async function getUidDek() {
  const user = auth.currentUser;
  if (!user) {
    clearUidDek();
    return null;
  }
  const uid = user.uid;

  if (uidDek && uidDek.uid === uid) {
    return uidDek;
  }
  const uidDekStr = localStorage.getItem("uidDek");
  if (uidDekStr) {
    const uidDekRaw = JSON.parse(uidDekStr);
    if (uidDekRaw.uid === uid) {
      uidDek = { uid, dek: await jwkToCryptoKey(uidDekRaw.dek) };
      return uidDek;
    }
  }
  return null;
}

const loginButton = document.getElementById("login-button")!;
onAuthStateChanged(auth, (user) => {
  if (user) {
    const email = user.email;
    loginButton!.textContent = email?.slice(0, 1).toUpperCase() || "U";
  } else {
    loginButton!.textContent = "login";
    clearUidDek();
  }
});

await auth.authStateReady();
if (auth.currentUser) {
  if (!(await getUidDek())) {
    auth.signOut();
  }
}

async function registerUser(email: string, password: string) {
  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password,
  );

  try {
    const salt = generateRandomBytes(16);
    const kek = await deriveKEK(password, salt);
    const dek = await generateDEK();

    const wrappedDek = await wrapDEK(dek, kek);

    await set(
      "users",
      {
        kek_salt: Bytes.fromUint8Array(salt),
        wrapped_dek: Bytes.fromUint8Array(wrappedDek),
      },
      userCredential.user.uid,
    );
    await setUidDek(userCredential.user.uid, dek);
  } catch (error) {
    await userCredential.user.delete();
    throw error;
  }
}

async function loginUser(email: string, password: string) {
  const userCredential = await signInWithEmailAndPassword(
    auth,
    email,
    password,
  );
  const user = await get("users", userCredential.user.uid);
  if (!user) {
    auth.signOut();
    throw new Error("User not found");
  }

  const kekSalt = user.kek_salt;
  const wrappedDek = user.wrapped_dek;

  const salt = kekSalt.toUint8Array();
  const kek = await deriveKEK(password, salt);
  const dek = await unwrapDEK(wrappedDek.toUint8Array(), kek);
  await setUidDek(userCredential.user.uid, dek);
}

const loginTemplate = document.getElementById(
  "login-template",
) as HTMLTemplateElement;
const registerTemplate = document.getElementById(
  "register-template",
) as HTMLTemplateElement;
const logoutTemplate = document.getElementById(
  "logout-template",
) as HTMLTemplateElement;

export function main() {
  loginButton.addEventListener("click", async function () {
    if (auth.currentUser) {
      const fragment = logoutTemplate.content.cloneNode(
        true,
      ) as DocumentFragment;
      const firstChild = fragment.firstElementChild as HTMLElement;
      const show = toggleModal(fragment, "block", true);
      if (!show) return;
      firstChild
        .querySelector("#logout-button")!
        .addEventListener("click", async function () {
          await auth.signOut();
          toggleModal(fragment);
        });
      return;
    }

    const fragment = loginTemplate.content.cloneNode(true) as DocumentFragment;
    const firstChild = fragment.firstElementChild as HTMLElement;
    const show = toggleModal(fragment, "block", true);
    if (!show) return;

    firstChild
      .querySelector("#login-form")!
      .addEventListener("submit", async function (e) {
        e.preventDefault();
        const emailInput = firstChild.querySelector(
          "#email-input",
        ) as HTMLInputElement;
        const passwordInput = firstChild.querySelector(
          "#password-input",
        ) as HTMLInputElement;
        const email = emailInput.value;
        const password = passwordInput.value;

        try {
          await loginUser(email, password);
          toggleModal(fragment);
        } catch (error) {
          console.error("Error logging in:", error);
        }
      });
    firstChild
      .querySelector("#register-button")!
      .addEventListener("click", async function () {
        const registerFragment = registerTemplate.content.cloneNode(
          true,
        ) as DocumentFragment;
        const firstChild = registerFragment.firstElementChild as HTMLElement;
        toggleModal(registerFragment, "block", true);
        firstChild
          .querySelector("#register-form")!
          .addEventListener("submit", async function (e) {
            e.preventDefault();
            const emailInput = firstChild.querySelector(
              "#email-input",
            ) as HTMLInputElement;
            const passwordInput = firstChild.querySelector(
              "#password-input",
            ) as HTMLInputElement;
            const confirmPasswordInput = firstChild.querySelector(
              "#confirm-password-input",
            ) as HTMLInputElement;
            const email = emailInput.value;
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;

            if (password !== confirmPassword) {
              console.error("Passwords do not match");
              return;
            }

            try {
              await registerUser(email, password);
              toggleModal(registerFragment);
            } catch (error) {
              console.error("Error registering user:", error);
            }
          });
      });
  });
}
