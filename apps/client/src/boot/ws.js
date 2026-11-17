import { shallowRef } from 'vue'
import io from 'socket.io-client'

let socket

export const wsConnected = shallowRef(false)

const connect = () => {
  const url = process.env.API_URL || window.location.origin

  socket = io(url, { path: '/socket.io' })

  socket.on('connect', () => {
    wsConnected.value = true
    console.log('[WS][socket.io] connected', { id: socket.id, url })
    // Socket.IO rooms don't survive a reconnect — the server only joins this
    // socket to the user's room in response to 'auth' (see socketManager.js).
    // Re-sending it here (not just once at login) is what keeps userId-room
    // pushes like generation progress working after any disconnect/reconnect.
    if (localStorage.token) socket.emit('auth', localStorage.token)
  })
  // a plugin was switched on or off by someone: the menus of this page may be out of date
  socket.on('plugins:changed', () => { import('../plugins/host').then((host) => host.checkPluginsChanged()) })
  socket.on('connect_error', (err) => {
    wsConnected.value = false
    console.error('[WS][socket.io] connect_error', { url, message: err?.message, err })
  })
  socket.on('disconnect', (reason) => {
    wsConnected.value = false
    console.warn('[WS][socket.io] disconnected', { url, reason })
  })
}

const disconnect = () => {
  if (socket) socket.disconnect()
}

export { socket, connect, disconnect }