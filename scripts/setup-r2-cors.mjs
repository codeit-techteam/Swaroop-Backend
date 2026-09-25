/**
 * Apply CORS on the R2 bucket so Seller Web (browser) can PUT via signed URLs.
 * Run once: node scripts/setup-r2-cors.mjs
 */
import { config } from 'dotenv';
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from '@aws-sdk/client-s3';

config();

const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey =
  process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
  console.error('Missing R2 credentials in .env');
  process.exit(1);
}

const client = new S3Client({
  region: process.env.R2_REGION || 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'HEAD'],
          AllowedOrigins: [
            'http://localhost:3003',
            'http://127.0.0.1:3003',
            'http://localhost:3001',
            'http://localhost:3002',
            'http://localhost:8081',
          ],
          ExposeHeaders: ['ETag', 'Content-Type', 'Content-Length'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

const cors = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log('CORS applied on bucket:', bucket);
console.log(JSON.stringify(cors.CORSRules, null, 2));
