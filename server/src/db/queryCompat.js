// Re-exported so service modules import `query` from the db layer without caring
// whether it came from the pool or a transaction client.
export { query } from './pool.js';
