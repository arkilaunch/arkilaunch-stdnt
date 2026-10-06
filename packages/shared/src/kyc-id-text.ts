import { spanConfidence, type DocumentText, type ExtractedField } from './document-intelligence-port.js';
import type { PhIdTypeCode } from './kyc.js';

type IdTextFields = Partial<Record<'first_name' | 'middle_name' | 'last_name' | 'address', ExtractedField>>;
// PRC prints "LAST NAME ► HOFER": the arrow is a separator, never part of the value.
const clean = (value: string) => value.replace(/^[\s|:;►▶>»•]+|[\s|;]+$/g, '').replace(/\s+/g, ' ').trim();
// No parsed field keeps a comma: "RAMOS, ELLA" splits at it, and address lines join with a space.
export const noComma = (value: string) => value.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
export const ID_TEXT_FIELDS = ['first_name', 'middle_name', 'last_name', 'address'] as const;
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

// QA 37: where each PH ID prints the name and the address, from the user's card samples (2026-10):
// - PhilSys, passport ("Apelyido/ Surname", "Pangalan/ Given names"), UMID, PRC ("LAST NAME ► HOFER") and the MySSS
//   card label each part. The old SSS card prints one unlabelled "FIRST MIDDLE LAST" line above the SS number.
// - The voter's ID prints three unlabelled lines (LAST / FIRST / MIDDLE) above "Date of Birth".
// - The postal ID prints "FIRST MIDDLE SURNAME SUFFIX" under "First Name, Middle Name, Surname, Suffix".
// - TIN IDs print "LAST, FIRST MIDDLE": the new card under "Name" with an "Address" block, the old card unlabelled
//   above the "TIN:" line with its address on the lines below it.
// The passport, SSS and PRC cards carry no address, so none is read.
type Layout =
  | { name: 'combined'; address: boolean } // "LAST, FIRST MIDDLE" under the combined label (LTO)
  | { name: 'split'; address: boolean; mrz?: boolean; fallback?: 'voters' | 'sss' }
  | { name: 'name-line'; address: boolean; tin?: boolean };
const LAYOUTS: Record<PhIdTypeCode, Layout> = {
  drivers_license: { name: 'combined', address: true },
  philsys: { name: 'split', address: true },
  umid: { name: 'split', address: true },
  voters: { name: 'split', address: true, fallback: 'voters' },
  prc: { name: 'split', address: false },
  passport: { name: 'split', address: false, mrz: true },
  postal: { name: 'name-line', address: true },
  tin_id: { name: 'name-line', address: true, tin: true },
  sss: { name: 'split', address: false, fallback: 'sss' },
};

// A label ends at a colon, a PRC arrow, the end of its line, or the value printed after it on the same line.
const END = String.raw`\s*(?::|[►▶>»•]|$|(?=\s\S))`;
const LAST = new RegExp(String.raw`^(?:apelyido\s*\/\s*)?(?:last\s*name|surname)${END}`, 'i');
const GIVEN = new RegExp(String.raw`^(?:(?:mga\s*)?pangalan\s*\/\s*)?(?:given\s*names?|first\s*name)${END}`, 'i');
const MIDDLE = new RegExp(String.raw`^(?:(?:panggitnang|gitnang)\s*apelyido\s*\/\s*)?middle\s*name${END}`, 'i');
const NAME = /^(?:pangalan\s*\/\s*)?(?:full\s*)?name\s*:?/i;
const POSTAL_NAME = /^first\s*name\s*,?\s*middle\s*name\s*,?\s*surname\s*(?:,?\s*suffix)?\s*:?/i;
const ADDRESS = /^(?:tirahan\s*\/\s*)?(?:residential\s*|permanent\s*)?address\s*:?/i;
// Any other label ends a multi-line address or name value.
const OTHER_LABEL = /^(?:petsa|date|birth|kasarian|sex|blood|uri\s*ng\s*dugo|marital|civil|citizenship|precinct|crn|prn|tin\b|pcn|place\s*of\s*birth|nationality|nasyonalidad|height|weight|valid|issu|expir|signature|lagda|sss|id\s*no|card\s*no|registration|reg\.?\s*no)/i;
const isLabel = (v: string) =>
  LAST.test(v) || GIVEN.test(v) || MIDDLE.test(v) || NAME.test(v) || POSTAL_NAME.test(v) || ADDRESS.test(v) || OTHER_LABEL.test(v) || NEXT_LABEL.test(v) || nameLabel(v);
const NAME_ONLY = /^[A-ZÑ][A-ZÑ .'-]*$/i;
const SUFFIX = /^(?:JR|SR|I{2,3}|IV|V)\.?$/i;
// Surname particles: "DELA CRUZ", "DE LA PAZ", "STA. MARIA" stay whole.
const PARTICLE = /^(?:DE|DEL|DELA|DELOS|DELAS|LA|LOS|LAS|SAN|STA|STO|VDA)\.?$/i;

// The value after a label: the rest of the label's own line, else the next line that is not itself a label.
function valueAfter(lines: Line[], re: RegExp): Line | undefined {
  const i = lines.findIndex((l) => re.test(l.value));
  if (i < 0) return undefined;
  const rest = clean(lines[i]!.value.replace(re, ''));
  if (rest) return { ...lines[i]!, value: rest };
  const next = lines[i + 1];
  return next && !isLabel(next.value) ? next : undefined;
}

// Up to four address lines from index `from`, ending at the next label. Lines join with a space, never a comma.
function addressFrom(text: DocumentText, lines: Line[], from: number, first?: Line): ExtractedField | undefined {
  const parts: Line[] = first ? [first] : [];
  for (const line of lines.slice(from)) {
    if (isLabel(line.value) || parts.length >= 4) break;
    parts.push(line);
  }
  return parts.length ? { value: noComma(parts.map((l) => l.value).join(' ')), confidence: conf(text, parts) } : undefined;
}

function addressAfter(text: DocumentText, lines: Line[]): ExtractedField | undefined {
  const i = lines.findIndex((l) => ADDRESS.test(l.value));
  if (i < 0) return undefined;
  const rest = clean(lines[i]!.value.replace(ADDRESS, ''));
  return addressFrom(text, lines, i + 1, rest ? { ...lines[i]!, value: rest } : undefined);
}

// A name suffix (JR, III) is not a middle name: it stays with the first name, as "THOMAS II" on the PRC card.
function splitGiven(tokens: string[]): { first: string; middle: string } {
  const suffix = tokens.length > 1 && SUFFIX.test(tokens.at(-1)!) ? tokens.pop()! : '';
  const middle = tokens.length >= 2 ? tokens.pop()! : '';
  return { first: [...tokens, suffix].filter(Boolean).join(' '), middle };
}

// "LAST, FIRST MIDDLE": the final given token is the middle name (as the LTO and TIN cards print it).
function commaName(text: DocumentText, line: Line): IdTextFields {
  const comma = line.value.indexOf(',');
  const last = clean(line.value.slice(0, comma));
  const tokens = noComma(line.value.slice(comma + 1)).split(/\s+/).filter(Boolean);
  if (comma <= 0 || !last || !tokens.length || NEXT_LABEL.test(line.value)) return {};
  const confidence = conf(text, [line]);
  const { first, middle } = splitGiven(tokens);
  return { last_name: { value: last, confidence }, middle_name: { value: middle, confidence }, first_name: { value: first, confidence } };
}

// "FIRST MIDDLE LAST [SUFFIX]" (postal, old SSS): the surname is the last word plus any particles before it
// (DELA CRUZ); the word before the surname is the middle name, full or an initial.
// ponytail: a two-word first name with no middle name ("MARIA ANA CRUZ") reads ANA as the middle name; the
// customer corrects it on the review form.
function spacedName(text: DocumentText, line: Line): IdTextFields {
  const tokens = noComma(line.value).split(/\s+/).filter(Boolean);
  const suffix = tokens.length > 2 && SUFFIX.test(tokens.at(-1)!) ? tokens.pop()! : '';
  if (tokens.length < 2) return {};
  const confidence = conf(text, [line]);
  const last = [tokens.pop()!];
  while (tokens.length > 1 && PARTICLE.test(tokens.at(-1)!)) last.unshift(tokens.pop()!);
  const { first, middle } = splitGiven([...tokens, ...(suffix ? [suffix] : [])]);
  return { first_name: { value: first, confidence }, middle_name: { value: middle, confidence }, last_name: { value: last.join(' '), confidence } };
}

const nameLine = (l: Line | undefined) => !!l && NAME_ONLY.test(l.value) && !isLabel(l.value);

// Voter's ID: LAST / FIRST / MIDDLE on the three lines above "Date of Birth".
function votersName(text: DocumentText, lines: Line[]): IdTextFields {
  const i = lines.findIndex((l) => /^date\s*of\s*birth/i.test(l.value));
  const [last, first, middle] = i >= 3 ? lines.slice(i - 3, i) : [];
  if (!nameLine(last) || !nameLine(first) || !nameLine(middle)) return {};
  const field = (l: Line) => ({ value: l.value, confidence: conf(text, [l]) });
  return { last_name: field(last!), first_name: field(first!), middle_name: field(middle!) };
}

// Old SSS card: the name is the line just above the SS number (never the SSS president's signature line).
function sssName(text: DocumentText, lines: Line[]): IdTextFields {
  const i = lines.findIndex((l) => /^\d{2}-?\d{7}-?\d$/.test(l.value.replace(/\s+/g, '')));
  return i > 0 && nameLine(lines[i - 1]) ? spacedName(text, lines[i - 1]!) : {};
}

// Old TIN card: "LAST, FIRST MIDDLE" just above the "TIN:" line, and the address on the lines below it.
function oldTin(text: DocumentText, lines: Line[]): IdTextFields {
  const i = lines.findIndex((l) => /^TIN\b\s*:?\s*\d/i.test(l.value));
  if (i < 0) return {};
  const fields: IdTextFields = i > 0 && lines[i - 1]!.value.includes(',') ? commaName(text, lines[i - 1]!) : {};
  const address = addressFrom(text, lines, i + 1);
  if (address) fields.address = address;
  return fields;
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
  const fields = parseFields(LAYOUTS[idType], text);
  for (const field of Object.values(fields)) field.value = noComma(field.value);
  return fields;
}

function parseFields(layout: Layout, text: DocumentText): IdTextFields {
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
    if (!last && !first && layout.fallback === 'voters') fields = votersName(text, lines);
    if (!last && !first && layout.fallback === 'sss') fields = sssName(text, lines);
  } else {
    const line = valueAfter(lines, POSTAL_NAME) ?? valueAfter(lines, NAME);
    if (line) fields = line.value.includes(',') ? commaName(text, line) : spacedName(text, line);
    else if (layout.tin) return oldTin(text, lines);
  }
  if (layout.address) {
    const address = addressAfter(text, lines);
    if (address) fields.address = address;
  }
  return fields;
}
