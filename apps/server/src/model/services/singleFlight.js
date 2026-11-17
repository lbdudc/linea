/**
 * Runs a task once at a time per key: a call that comes while another with the same key is running gets that one's result instead of
 * starting a second. The page asks for lines, products and the dashboard at once, and each would otherwise make the same records.
 */
export const singleFlight = () => {
  const running = new Map();
  return (key, task) => {
    if (running.has(key)) return running.get(key);
    const flight = task().finally(() => running.delete(key));
    running.set(key, flight);
    return flight;
  };
};
