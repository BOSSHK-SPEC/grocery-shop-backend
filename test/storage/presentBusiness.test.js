import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorageConfigForTests } from '../../src/storage/config.js';
import { presentBusiness, presentKyc } from '../../src/storage/imageStorage.js';

// Presigning is a local computation, so no MinIO is needed for these.
process.env.MINIO_ENDPOINT = '127.0.0.1';
process.env.MINIO_PORT = '9000';
process.env.MINIO_ACCESS_KEY = 'test-access';
process.env.MINIO_SECRET_KEY = 'test-secret-key';
process.env.MINIO_PUBLIC_URL = 'https://images.example.com';
resetStorageConfigForTests();

const PAN = 'storage:private/licences/2026/09/46613234-d487-4bb0-b2c0-1d79f012b717.webp';
const FSSAI = 'storage:private/licences/2026/09/8390b99a-87af-48bd-bfed-f546e4b65e3f.webp';

const business = () => ({
  id: 'b1',
  businessName: 'Manju stores',
  kyc: { pan: 'ABCDE1234F', panPhoto: PAN, fssaiPhoto: FSSAI, status: 'SUBMITTED' },
  payoutAccount: { upiId: 'a@bank' },
});

test('private KYC photos become short-lived signed links, never raw refs', async () => {
  const kyc = await presentKyc(business().kyc);
  for (const field of ['panPhoto', 'fssaiPhoto']) {
    assert.match(kyc[field], /^https:\/\/images\.example\.com\/grocery-private\/licences\//);
    assert.match(kyc[field], /X-Amz-Signature=/);
    assert.match(kyc[field], /X-Amz-Expires=900/);
    assert.ok(!kyc[field].startsWith('storage:'));
  }
  assert.equal(kyc.pan, 'ABCDE1234F');
});

test('a missing photo stays missing and legacy values pass through', async () => {
  assert.equal(await presentKyc(null), null);
  const kyc = await presentKyc({ pan: 'X', panPhoto: null, fssaiPhoto: '/uploads/old.png' });
  assert.equal(kyc.panPhoto, null);
  assert.equal(kyc.fssaiPhoto, '/uploads/old.png');
});

test('viewers who are not the owner or an admin never receive KYC or payout details', async () => {
  const shopper = await presentBusiness(business());
  assert.equal('kyc' in shopper, false);
  assert.equal('payoutAccount' in shopper, false);
  assert.equal(shopper.businessName, 'Manju stores');
});

test('owners and admins receive KYC with signed links', async () => {
  const owner = await presentBusiness(business(), { includePrivate: true });
  assert.match(owner.kyc.panPhoto, /X-Amz-Signature=/);
  assert.equal(owner.payoutAccount.upiId, 'a@bank');
});
