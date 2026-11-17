// The app's script is heavy to run (about 300 ms): it starts after the frame in index.html has been painted, so that is what is seen first
// when the files are already in the browser. A tab that is not shown does not paint, so a timer starts it anyway.
let started = false
const start = () => {
  if (started) return
  started = true
  import('./main.js')
}
requestAnimationFrame(() => setTimeout(start, 0))
setTimeout(start, 400)
