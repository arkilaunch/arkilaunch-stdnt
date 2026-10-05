import { spanConfidence, type DocumentText, type ExtractedField } from './document-intelligence-port.js';
import type { PhIdTypeCode } from './kyc.js';

type IdTextFields = Partial<Record<'first_name' | 'middle_name' | 'last_name' | 'address', ExtractedField>>;
const clean = (value: string) => value.replace(/^[\s|:;]+|[\s|;]+$/g, '').replace(/\s+/g, ' ').trim();
const labelKey = (value: string) => value.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o').replace(/[^a-z]/g, '');

// Only the complete combined label is fuzzy-matched: permit one substituted,
// missing or extra character, without treating a value as a name label.
function nameLabel(value: string): boolean {
  const actual = labelKey(value);
  const expected = 'lastnamefirstnamemiddlename';
  if (actual === expected) return true;
  if (Math.abs(actual.length - expected.length) > 1) return false;
  let a = 0, b = 0, edits = 0;
  while (a < actual.length && b < expected.length) {
    if (actual[a] === expected[b]) { a++; b++; continue; }
    if (++edits > 1) return false;
    if (actual.length >= expected.length) a++;
    if (actual.length <= expected.length) b++;
  }
  return edits + (actual.length - a) + (expected.length - b) <= 1;
}

const NEXT_LABEL = /^(?:licen[sc]e\s*(?:no\.?|number)|expiration\s*date|agency\s*code|blood\s*type|eyes?\s*colou?r|conditions?|weight|height|sex|date\s*of\s*birth|nationality|restrictions?|last\s*name)\b/i;

export function parseIdText(idType: PhIdTypeCode, text: DocumentText): IdTextFields {
  if (idType !== 'drivers_license') return {};
  const lines = text.lines.map((line) => ({ ...line, value: clean(text.content.slice(line.offset, line.offset + line.length)) }))
    .sort((a, b) => a.offset - b.offset).filter((line) => line.value);
  const fields: IdTextFields = {};
  const nameIndex = lines.findIndex((line) => nameLabel(line.value));
  const name = nameIndex >= 0 ? lines[nameIndex + 1] : undefined;
  if (name) {
    const comma = name.value.indexOf(',');
    const last = clean(name.value.slice(0, comma));
    const tokens = clean(name.value.slice(comma + 1)).split(/\s+/).filter(Boolean);
    if (comma > 0 && last && tokens.length && !NEXT_LABEL.test(name.value)) {
      const confidence = spanConfidence(text.words, name.offset, name.offset + name.length);
      fields.last_name = { value: last, confidence };
      fields.middle_name = { value: tokens.length >= 2 ? tokens.pop()! : '', confidence };
      fields.first_name = { value: tokens.join(' '), confidence };
    }
  }
  const addressIndex = lines.findIndex((line) => /^address\s*:?$/i.test(line.value));
  if (addressIndex >= 0) {
    const parts: typeof lines = [];
    for (const line of lines.slice(addressIndex + 1)) {
      if (NEXT_LABEL.test(line.value) || nameLabel(line.value)) break;
      parts.push(line);
    }
    if (parts.length) fields.address = {
      value: parts.map((line) => line.value).join(', '),
      confidence: Math.min(...parts.map((line) => spanConfidence(text.words, line.offset, line.offset + line.length))),
    };
  }
  return fields;
}
