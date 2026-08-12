// Fires on every verified submission of the contact form and forwards it to the
// talent inbox. This lives in the repo so delivery survives dashboard changes —
// the Netlify UI email notification is a second, independent path to the same inbox.

const TALENT_INBOX = 'talent@flowmint-talent.com'

// Resend needs a verified sender on the flowmint-talent.com domain. Override via
// env if the sending domain ever changes.
const FROM = process.env.FORM_FROM_EMAIL || 'website@flowmint-talent.com'

// Field name -> label, in the order they should read in the email.
const FIELDS: [string, string][] = [
  ['enquiry-type', 'Enquiry type'],
  ['name', 'Name'],
  ['email', 'Email'],
  ['company', 'Company'],
  ['location', 'Location'],
  ['message', 'Message'],
]

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderBody(data: Record<string, string>) {
  const seen = new Set(FIELDS.map(([key]) => key))

  // Anything added to the form later still comes through, just at the bottom.
  const extras = Object.keys(data)
    .filter((key) => !seen.has(key) && !['form-name', 'subject', 'bot-field'].includes(key))
    .map((key) => [key, key] as [string, string])

  const rows = [...FIELDS, ...extras]
    .filter(([key]) => data[key])
    .map(
      ([key, label]) =>
        `<tr><td style="padding:6px 16px 6px 0;vertical-align:top;color:#667;white-space:nowrap">${escapeHtml(
          label,
        )}</td><td style="padding:6px 0;vertical-align:top;white-space:pre-wrap">${escapeHtml(
          data[key],
        )}</td></tr>`,
    )
    .join('')

  return `<table style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${rows}</table>`
}

export default async (req: Request) => {
  let payload: { form_name?: string; data?: Record<string, string> } = {}

  try {
    payload = (await req.json()).payload ?? {}
  } catch {
    console.error('[form] could not parse submission payload')
    return new Response('Bad payload', { status: 200 })
  }

  const data = payload.data ?? {}
  const isCandidate = /candidate/i.test(data['enquiry-type'] || '')
  const subject =
    data.subject ||
    (isCandidate ? 'New candidate registration — FlowMint Talent' : 'New hiring brief — FlowMint Talent')

  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    // Nothing to send with. Log the submission in full so it is recoverable from
    // the function log even if the dashboard notification is also missing.
    console.error(
      `[form] RESEND_API_KEY is not set — could not forward to ${TALENT_INBOX}. Submission: ${JSON.stringify(data)}`,
    )
    return new Response('No mail provider configured', { status: 200 })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `FlowMint Website <${FROM}>`,
        to: [TALENT_INBOX],
        // Replying in the inbox goes straight back to the person who submitted.
        reply_to: data.email ? [data.email] : undefined,
        subject,
        html: renderBody(data),
      }),
    })

    if (!res.ok) {
      console.error(`[form] forward failed (${res.status}): ${await res.text()}`)
      console.error(`[form] undelivered submission: ${JSON.stringify(data)}`)
    } else {
      console.log(`[form] forwarded ${isCandidate ? 'candidate' : 'employer'} submission to ${TALENT_INBOX}`)
    }
  } catch (err) {
    console.error('[form] forward threw:', err)
    console.error(`[form] undelivered submission: ${JSON.stringify(data)}`)
  }

  // Always 200 — the submission is already stored by Netlify Forms and should
  // never be retried or marked failed because of a mail provider hiccup.
  return new Response('OK', { status: 200 })
}
