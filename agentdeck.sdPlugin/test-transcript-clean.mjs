import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCustomWords, cleanTranscript, collapseStutters, removeFillers } from './transcript-clean.mjs';

test('removes fillers and recapitalises the sentence start', () => {
  assert.equal(removeFillers('Um, so we ship uh on Friday.'), 'So we ship on Friday.');
});

test('collapses 3+ repeats but keeps double words', () => {
  assert.equal(collapseStutters('we we we should go, no no'), 'we should go, no no');
});

test('corrects sound-alike vocabulary terms and keeps punctuation', () => {
  assert.equal(applyCustomWords('Ask Kubernetties, then deploy.', ['Kubernetes']), 'Ask Kubernetes, then deploy.');
  assert.equal(applyCustomWords('the weather is nice', ['Kubernetes']), 'the weather is nice');
});

test('cleanTranscript combines the steps', () => {
  assert.equal(cleanTranscript('Uh the the the Inspector  works', { vocabulary: ['Inspector'] }), 'The Inspector works');
});
