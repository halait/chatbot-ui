import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import app from "./firebase.js";
import { toggleModal } from "./modal.js";


const auth = getAuth(app);

async function registerUser(email: string, password: string) {
  return await createUserWithEmailAndPassword(auth, email, password)
}

async function loginUser(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

const loginTemplate = document.getElementById('login-template') as HTMLTemplateElement
const registerTemplate = document.getElementById('register-template') as HTMLTemplateElement
const logoutTemplate = document.getElementById('logout-template') as HTMLTemplateElement

export function main() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      const uid = user.uid;
      console.log('User is signed in with uid:', uid)
      const email = user.email;
      loginButton!.textContent = email?.slice(0, 1).toUpperCase() || 'U'
    } else {
      loginButton!.textContent = 'login'
    }
  })
  const loginButton = document.getElementById('login-button')!
  loginButton.addEventListener('click', async function () {
    if(auth.currentUser) {
      const fragment = logoutTemplate.content.cloneNode(true) as DocumentFragment
      const firstChild = fragment.firstElementChild as HTMLElement
      const show = toggleModal(fragment, 'block', true)
      if (!show) return
      firstChild.querySelector('#logout-button')!.addEventListener('click', async function () {
        await auth.signOut()
        toggleModal(fragment)
      })
      return
    }

    const fragment = loginTemplate.content.cloneNode(true) as DocumentFragment
    const firstChild = fragment.firstElementChild as HTMLElement
    const show = toggleModal(fragment, 'block', true)
    if (!show) return

    firstChild.querySelector('#login-form')!.addEventListener('submit', async function (e) {
      e.preventDefault()
      const emailInput = firstChild.querySelector('#email-input') as HTMLInputElement
      const passwordInput = firstChild.querySelector('#password-input') as HTMLInputElement
      const email = emailInput.value
      const password = passwordInput.value

      try {
        const userCredential = await loginUser(email, password)
        console.log('User logged in:', userCredential.user)
        toggleModal(fragment)
      } catch (error) {
        console.error('Error logging in:', error)
      }
    })
    firstChild.querySelector('#register-button')!.addEventListener('click', async function () {
      const registerFragment = registerTemplate.content.cloneNode(true) as DocumentFragment
      const firstChild = registerFragment.firstElementChild as HTMLElement
      toggleModal(registerFragment, 'block', true)
      firstChild.querySelector('#register-form')!.addEventListener('submit', async function (e) {
        e.preventDefault()
        const emailInput = firstChild.querySelector('#email-input') as HTMLInputElement
        const passwordInput = firstChild.querySelector('#password-input') as HTMLInputElement
        const confirmPasswordInput = firstChild.querySelector('#confirm-password-input') as HTMLInputElement
        const email = emailInput.value
        const password = passwordInput.value
        const confirmPassword = confirmPasswordInput.value

        if (password !== confirmPassword) {
          console.error('Passwords do not match')
          return
        }

        try {
          const userCredential = await registerUser(email, password)
          console.log('User registered:', userCredential.user)
          toggleModal(registerFragment)
        } catch (error) {
          console.error('Error registering user:', error)
        }
      })
    })
  })


}