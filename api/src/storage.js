const { v4: uuidv4 } = require('uuid');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'media';

async function uploadBuffer(buffer, mimetype) {
  const ext = (mimetype.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
  const key = `reports/${uuidv4()}.${ext}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': mimetype,
      'x-upsert': 'false',
    },
    body: buffer,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase Storage upload failed (${res.status}): ${body}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`;
}

module.exports = { uploadBuffer };
