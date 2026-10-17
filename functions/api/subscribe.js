// POST /api/subscribe — sign-up for the Evening Brief.
// Adds the address to the Brevo "Evening Brief" list through Brevo's double opt-in flow: Brevo emails a
// confirmation link, and the address only receives the brief after it is clicked.
// Pages environment variables (Settings → Variables and secrets):
//   BREVO_API_KEY (secret), BREVO_LIST_ID, BREVO_DOI_TEMPLATE_ID

const EMAIL = /^[^\s@<>()"',;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  let data = {};
  const type = request.headers.get('content-type') || '';
  try {
    data = type.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
  } catch (e) { return json({ ok: false, error: 'Could not read the form.' }, 400); }

  // Honeypot: real people never fill the hidden "website" field.
  if (data.website) return json({ ok: true });
  const email = String(data.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

  if (!env.BREVO_API_KEY || !env.BREVO_LIST_ID || !env.BREVO_DOI_TEMPLATE_ID) {
    return json({ ok: false, error: 'Sign-ups open soon. Please try again in a few days.' }, 503);
  }
  const origin = new URL(request.url).origin;
  const res = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      email,
      includeListIds: [Number(env.BREVO_LIST_ID)],
      templateId: Number(env.BREVO_DOI_TEMPLATE_ID),
      redirectionUrl: origin + '/brief/?confirmed=1',
    }),
  });
  if (res.ok) return json({ ok: true });
  const detail = await res.text();
  console.log('Brevo DOI error', res.status, detail.slice(0, 300));
  return json({ ok: false, error: 'Sign-up failed. Please try again later.' }, 502);
}

export const onRequestGet = () => json({ ok: false, error: 'Use POST.' }, 405);
