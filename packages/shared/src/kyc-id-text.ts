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

type Line = { offset: number; length: number; value: string };
const conf = (text: DocumentText, parts: Line[]) =>
  parts.length ? Math.min(...parts.map((l) => spanConfidence(text.words, l.offset, l.offset + l.length))) : 0;

// QA 36: where each PH ID prints the name and the address (checked against current card samples, 2026-10). PhilSys
// and the passport label in Filipino and English ("Apelyido/Last Name"); UMID, PRC and voter's IDs in English only.
// Postal and TIN IDs print one "Name" line. The passport, SSS and PRC cards carry no address, so none is read.
type Layout =
  | { name: 'combined'; address: boolean } // "LAST, FIRST MIDDLE" under the combined label (LTO)
  | { name: 'split'; address: boolean; mrz?: boolean }
  | { name: 'name-line'; address: boolean }
  | { name: 'none'; address: false };
const LAYOUTS: Record<PhIdTypeCode, Layout> = {
  drivers_license: { name: 'combined', address: true },
  philsys: { name: 'split', address: true },
  umid: { name: 'split', address: true },
  voters: { name: 'split', address: true },
  prc: { name: 'split', address: false },
  passport: { name: 'split', address: false, mrz: true },
  postal: { name: 'name-line', address: true },
  tin_id: { name: 'name-line', address: true },
  sss: { name: 'none', address: false }, // one unlabelled name line; the query field already reads it
};

const LAST = /^(?:(?:apelyido)\s*\/\s*)?(?:last\s*name|surname)\s*(?::|$)/i;
const GIVEN = /^(?:(?:mga\s*pangalan)\s*\/\s*)?(?:given\s*names?|first\s*name)\s*(?::|$)/i;
const MIDDLE = /^(?:(?:panggitnang|gitnang)\s*apelyido\s*\/\s*)?middle\s*name\s*(?::|$)/i;
const NAME = /^(?:pangalan\s*\/\s*)?(?:full\s*)?name\s*:?/i;
const ADDRESS = /^(?:tirahan\s*\/\s*)?(?:residential\s*|permanent\s*)?address\s*:?/i;
// Any other label ends a multi-line address or name value.
const OTHER_LABEL = /^(?:petsa|date|kasarian|sex|blood|uri\s*ng\s*dugo|marital|civil|precinct|crn|prn|tin\b|pcn|place\s*of\s*birth|nationality|nasyonalidad|height|weight|valid|issued|expir|signature|lagda|sss|id\s*no|card\s*no|registration|reg\.?\s*no)/i;
const isLabel = (v: string) => LAST.test(v) || GIVEN.test(v) || MIDDLE.test(v) || NAME.test(v) || ADDRESS.test(v) || OTHER_LABEL.test(v) || NEXT_LABEL.test(v) || nameLabel(v);

// The value after a label: the rest of the label's own line, else the next line that is not itself a label.
function valueAfter(lines: Line[], re: RegExp): Line | undefined {
  const i = lines.findIndex((l) => re.test(l.value));
  if (i < 0) return undefined;
  const rest = clean(lines[i]!.value.replace(re, ''));
  if (rest) return { ...lines[i]!, value: rest };
  const next = lines[i + 1];
  return next && !isLabel(next.value) ? next : undefined;
}

function addressAfter(text: DocumentText, lines: Line[]): ExtractedField | undefined {
  const i = lines.findIndex((l) => ADDRESS.test(l.value));
  if (i < 0) return undefined;
  const parts: Line[] = [];
  const rest = clean(lines[i]!.value.replace(ADDRESS, ''));
  if (rest) parts.push({ ...lines[i]!, value: rest });
  for (const line of lines.slice(i + 1)) {
    if (isLabel(line.value) || parts.length >= 4) break;
    parts.push(line);
  }
  return parts.length ? { value: parts.map((l) => l.value.replace(/,$/, '')).join(', '), confidence: conf(text, parts) } : undefined;
}

// "LAST, FIRST MIDDLE": the final given token is the middle name (as the LTO card prints it).
function commaName(text: DocumentText, line: Line): IdTextFields {
  const comma = line.value.indexOf(',');
  const last = clean(line.value.slice(0, comma));
  const tokens = clean(line.value.slice(comma + 1)).split(/\s+/).filter(Boolean);
  if (comma <= 0 || !last || !tokens.length || NEXT_LABEL.test(line.value)) return {};
  const confidence = conf(text, [line]);
  return {
    last_name: { value: last, confidence },
    middle_name: { value: tokens.length >= 2 ? tokens.pop()! : '', confidence },
    first_name: { value: tokens.join(' '), confidence },
  };
}

// "FIRST M. LAST" (postal): a lone initial before the surname is the middle name; otherwise there is none to read.
function spacedName(text: DocumentText, line: Line): IdTextFields {
  const tokens = line.value.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return {};
  const confidence = conf(text, [line]);
  const last = tokens.pop()!;
  const middle = tokens.length >= 2 && /^[A-ZÑ]\.?$/i.test(tokens.at(-1)!) ? tokens.pop()! : '';
  return { first_name: { value: tokens.join(' '), confidence }, middle_name: { value: middle, confidence }, last_name: { value: last, confidence } };
}

// Passport MRZ line 1: P<PHLSURNAME<<GIVEN<NAMES<<<. Machine-printed, so it wins over the visual zone.
function mrzName(text: DocumentText, lines: Line[]): IdTextFields {
  const line = lines.find((l) => /^P[<A-Z]PHL[A-Z<]+$/.test(l.value.replace(/\s+/g, '')));
  if (!line) return {};
  const [surname, given = ''] = line.value.replace(/\s+/g, '').slice(5).split('<<');
  const words = (v: string) => v.split('<').filter(Boolean).join(' ');
  if (!surname) return {};
  const confidence = conf(text, [line]);
  return { last_name: { value: words(surname), confidence }, first_name: { value: words(given), confidence } };
}

export function parseIdText(idType: PhIdTypeCode, text: DocumentText): IdTextFields {
  const layout = LAYOUTS[idType];
  if (layout.name === 'none') return {};
  const lines: Line[] = text.lines.map((line) => ({ ...line, value: clean(text.content.slice(line.offset, line.offset + line.length)) }))
    .sort((a, b) => a.offset - b.offset).filter((line) => line.value);
  let fields: IdTextFields = {};
  if (layout.name === 'combined') {
    const i = lines.findIndex((line) => nameLabel(line.value));
    if (i >= 0 && lines[i + 1]) fields = commaName(text, lines[i + 1]!);
  } else if (layout.name === 'split') {
    const field = (re: RegExp) => {
      const line = valueAfter(lines, re);
      return line ? { value: line.value, confidence: conf(text, [line]) } : undefined;
    };
    const last = field(LAST);
    const first = field(GIVEN);
    const middle = field(MIDDLE);
    if (last) fields.last_name = last;
    if (first) fields.first_name = first;
    if (middle) fields.middle_name = middle;
    if (layout.mrz) fields = { ...fields, ...mrzName(text, lines) };
  } else {
    const line = valueAfter(lines, NAME);
    if (line) fields = line.value.includes(',') ? commaName(text, line) : spacedName(text, line);
  }
  if (layout.address) {
    const address = addressAfter(text, lines);
    if (address) fields.address = address;
  }
  return fields;
}
