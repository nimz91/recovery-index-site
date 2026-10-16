// GET /api/me — checks a buyer's access key (Bearer) and returns their bidding identity.
import { json, bad, needDb, buyerFromRequest } from '../_lib/util.js';

export async function onRequestGet({ request, env }) {
  const miss = needDb(env); if (miss) return miss;
  const b = await buyerFromRequest(request, env);
  if (!b) return bad('That access key was not recognised.', 401);
  return json({ company: b.company, alias: b.alias, status: b.status, category: b.category });
}
