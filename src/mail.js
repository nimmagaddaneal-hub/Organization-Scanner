// Sends a demo request to the site owner's own email through Resend (https://resend.com), using plain HTTPS.
// Free hosts such as Render block normal email (SMTP) connections, so an email API is used instead.

const clean = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

// Returns a function that emails one demo request, or null when email is not set up.
export function makeDemoNotifier({ apiKey, to, from, fetchImpl = fetch }) {
  if (!apiKey || !to) return null;
  return async (request) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from || 'Item Check-out <onboarding@resend.dev>',
        to: [to],
        // Replying goes straight to the person who asked.
        reply_to: clean(request.email),
        subject: `Demo request: ${clean(request.school)}`.slice(0, 200),
        text: [
          `${clean(request.name)} asked for a demo.`,
          '',
          `School: ${clean(request.school)}`,
          `Name: ${clean(request.name)}`,
          `Email: ${clean(request.email)}`,
          `Role: ${clean(request.role) || '(not given)'}`,
          '',
          'What they would like to lend out:',
          String(request.message || '(not given)'),
          '',
          'Reply to this email to answer them. To set them up, run: npm run schools -- add "School name"',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`The email service answered ${response.status}`);
  };
}
