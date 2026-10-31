import fs from 'node:fs';
import { connectSession, requireLogin } from './index.mjs';

const expectedName = process.env.EXPECTED_BUILDER_NAME?.trim();

if (process.argv[2] === 'verify' && !expectedName) {
  throw new Error('Set EXPECTED_BUILDER_NAME before verifying your Builder identity.');
}

const session = JSON.parse(fs.readFileSync('login-session.json', 'utf8'));
const browser = await connectSession(session);

try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  if (process.argv[2] === 'verify') {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await requireLogin(page, expectedName);
    console.log('Builder identity verified.');
  } else {
    await page.goto('https://builder.aws.com/', {
      waitUntil: 'domcontentloaded'
    });
    console.log('Builder sign-in ready in AWS live view.');
  }
} finally {
  await browser.close();
}
