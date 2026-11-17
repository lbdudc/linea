import { useRouter } from 'vue-router'
import userService from 'src/services/userService'
import { clearUserData } from 'stores/userState'
import { disconnect } from 'src/boot/ws'

export function useSignOut() {
  const router = useRouter()
  return async () => {
    await userService.logout()
    localStorage.removeItem('token')
    clearUserData()
    disconnect()
    router.push('/login')
  }
}
