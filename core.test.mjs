import test from 'node:test';
import assert from 'node:assert/strict';
import {localDay, addDays, inWindow, articleUrl, validateDraft} from './core.mjs';
test('90 calendar days, including the final day and excluding day 91',()=>{
 assert.equal(addDays('2026-10-31',89),'2027-01-28');
 assert.equal(inWindow('2026-10-30','2026-10-31'),false);
 assert.equal(inWindow('2027-01-28','2026-10-31'),true);
 assert.equal(inWindow('2027-01-29','2026-10-31'),false);
});
test('Sofia date follows local midnight and summer time',()=>{
 assert.equal(localDay(new Date('2026-10-30T22:30:00Z')),'2026-10-31');
 assert.equal(localDay(new Date('2026-06-01T21:30:00Z')),'2026-06-02');
});
test('reject outbound URLs and non-article pages',()=>{
 assert.equal(articleUrl('/content/Ab123/example#comments'),'https://builder.aws.com/content/Ab123/example');
 for(const u of ['https://evil.example/content/Ab123/x','https://builder.aws.com.evil.example/content/Ab123/x','/poll/Ab123/x','javascript:alert(1)']) assert.throws(()=>articleUrl(u));
});
test('skip and reject invalid or promotional model responses',()=>{
 assert.equal(validateDraft('{"skip":true}'),null);
 assert.throws(()=>validateDraft('{"comment":"Try https://evil.example for a free offer!","evidence":"article text"}'));
 assert.throws(()=>validateDraft('plain text'));
 assert.deepEqual(validateDraft(JSON.stringify({comment:'How does the queue handle a second update during processing?',evidence:'queue handles updates'})),{comment:'How does the queue handle a second update during processing?',evidence:'queue handles updates'});
});
